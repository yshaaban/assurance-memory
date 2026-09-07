package dev.assurance.core;
import javax.sql.DataSource;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.function.Function;
/** PostgreSQL implementation. One short writer transaction per workspace, keyset-paginated reads.
* The workspace row lock fences all writers across server replicas. Never hold it while running a checker.
* Tenant/workspace predicates are included on every operation; application credentials are not agent credentials. */
public final class JdbcStore implements Store {
    private final DataSource dataSource;
    public JdbcStore(DataSource d) {
        dataSource=d;
    }
    public void migrate() {
        try(Connection c=dataSource.getConnection()) {
            c.setAutoCommit(false);
            try(Statement s=c.createStatement()) {
                s.execute("SELECT pg_advisory_xact_lock(4180259432471)");
                s.execute("CREATE TABLE IF NOT EXISTS am_schema_version(version INTEGER PRIMARY KEY)");
                int version=0;
                try(ResultSet r=s.executeQuery("SELECT COALESCE(MAX(version),0) FROM am_schema_version")) {
                    r.next();
                    version=r.getInt(1);
                }
                if(version>1)throw new IllegalStateException("Database schema is newer than this server");
                if(version==0) {
                    try(var input=JdbcStore.class.getResourceAsStream("/db/migration/V001.sql")) {
                        if(input==null)throw new IllegalStateException("Missing schema migration");
                        for(String sql:new String(input.readAllBytes(),StandardCharsets.UTF_8).split(";"))if(!sql.isBlank())s.execute(sql);
                    }
                    s.executeUpdate("INSERT INTO am_schema_version(version) VALUES(1)");
                }
                c.commit();
            }
            catch(Exception e) {
                c.rollback();
                throw e;
            }
        }
        catch(SQLException|IOException e) {
            throw new IllegalStateException("Schema initialization failed",e);
        }
    }
    public <T>T write(Space space,Function<Tx,T> fn) {
        return transaction(space,false,fn);
    }
    public <T>T read(Space space,Function<Tx,T> fn) {
        return transaction(space,true,fn);
    }
    private <T>T transaction(Space space,boolean readOnly,Function<Tx,T> fn) {
        try(Connection c=dataSource.getConnection()) {
            c.setAutoCommit(false);
            c.setTransactionIsolation(readOnly?Connection.TRANSACTION_REPEATABLE_READ:Connection.TRANSACTION_READ_COMMITTED);
            c.setReadOnly(readOnly);
            try {
                if(!readOnly) {
                    try(PreparedStatement s=c.prepareStatement("INSERT INTO am_workspace(tenant,workspace) VALUES(?,?) ON CONFLICT DO NOTHING")) {
                        s.setString(1,space.tenant());
                        s.setString(2,space.workspace());
                        s.executeUpdate();
                    }
                    try(PreparedStatement s=c.prepareStatement("SELECT sequence FROM am_workspace WHERE tenant=? AND workspace=? FOR UPDATE")) {
                        s.setString(1,space.tenant());
                        s.setString(2,space.workspace());
                        s.setQueryTimeout(20);
                        try(ResultSet r=s.executeQuery()) {
                            if(!r.next())throw new IllegalStateException("Workspace lock missing");
                        }
                    }
                }
                T result=fn.apply(new JdbcTx(c,space,readOnly));
                c.commit();
                return result;
            }
            catch(RuntimeException|SQLException e) {
                c.rollback();
                throw e;
            }
        }
        catch(SQLException e) {
            throw new Problem(503,"STORE_UNAVAILABLE","Database transaction failed; retry with the same idempotency key");
        }
    }
    public List<Space> spaces() {
        try(Connection c=dataSource.getConnection(); PreparedStatement s=c.prepareStatement("SELECT tenant,workspace FROM am_workspace ORDER BY tenant,workspace"); ResultSet r=s.executeQuery()) {
            List<Space> result=new ArrayList<>();
            while(r.next())result.add(new Space(r.getString(1),r.getString(2)));
            return result;
        }
        catch(SQLException e) {
            throw new IllegalStateException("Cannot list workspaces",e);
        }
    }
    private static final class JdbcTx implements Tx {
        private final Connection c;
        private final Space space;
        private final boolean readOnly;
        JdbcTx(Connection c,Space space,boolean readOnly) {
            this.c=c;
            this.space=space;
            this.readOnly=readOnly;
        }
        private PreparedStatement sql(String text,Object... values)throws SQLException {
            PreparedStatement s=c.prepareStatement(text);
            s.setQueryTimeout(20);
            s.setString(1,space.tenant());
            s.setString(2,space.workspace());
            for(int i=0; i<values.length; i++)s.setObject(i+3,values[i]);
            return s;
        }
        private RuntimeException fail(SQLException e) {
            return new Problem(503,"STORE_UNAVAILABLE","Database operation failed; retry with the same idempotency key");
        }
        private void writable() {
            if(readOnly)throw new IllegalStateException("Read transaction mutated");
        }
        public Optional<Doc> get(String kind,String id) {
            try(PreparedStatement s=sql("SELECT version,body FROM am_document WHERE tenant=? AND workspace=? AND kind=? AND id=?",kind,id); ResultSet r=s.executeQuery()) {
                return r.next()?Optional.of(new Doc(id,r.getLong(1),Json.map(Json.parse(r.getString(2))))):Optional.empty();
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
        public List<Doc> page(String kind,String after,int limit) {
            Problem.require(limit>0&&limit<=1000,"Page limit must be 1..1000");
            try(PreparedStatement s=sql("SELECT id,version,body FROM am_document WHERE tenant=? AND workspace=? AND kind=? AND id>? ORDER BY id LIMIT ?",kind,after,limit); ResultSet r=s.executeQuery()) {
                List<Doc> out=new ArrayList<>();
                while(r.next())out.add(new Doc(r.getString(1),r.getLong(2),Json.map(Json.parse(r.getString(3)))));
                return out;
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
        public void put(String kind,String id,long expected,Map<String,Object> body) {
            writable();
            try {
                int count;
                if(expected==0) {
                    try(PreparedStatement s=sql("INSERT INTO am_document(tenant,workspace,kind,id,version,body,updated_ms) VALUES(?,?,?,?,1,?,?) ON CONFLICT DO NOTHING",kind,id,Json.write(body),System.currentTimeMillis())) {
                        count=s.executeUpdate();
                    }
                }
                else {
                    try(PreparedStatement s=sql("UPDATE am_document SET version=version+1,body=?,updated_ms=? WHERE tenant=? AND workspace=? AND kind=? AND id=? AND version=?")) {
                        // This statement has a different parameter order; bind explicitly.
                        s.setString(1,Json.write(body));
                        s.setLong(2,System.currentTimeMillis());
                        s.setString(3,space.tenant());
                        s.setString(4,space.workspace());
                        s.setString(5,kind);
                        s.setString(6,id);
                        s.setLong(7,expected);
                        count=s.executeUpdate();
                    }
                }
                if(count!=1)throw Problem.conflict("Version changed");
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
        public void delete(String kind,String id,long expected) {
            writable();
            try(PreparedStatement s=sql("DELETE FROM am_document WHERE tenant=? AND workspace=? AND kind=? AND id=? AND version=?",kind,id,expected)) {
                if(s.executeUpdate()!=1&&expected!=0)throw Problem.conflict("Version changed");
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
        public Set<String> incoming(String relation,String target) {
            try(PreparedStatement s=sql("SELECT source FROM am_link WHERE tenant=? AND workspace=? AND relation=? AND target=? ORDER BY source",relation,target); ResultSet r=s.executeQuery()) {
                Set<String> out=new TreeSet<>();
                while(r.next())out.add(r.getString(1));
                return out;
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
        public Set<String> outgoing(String relation,String source) {
            try(PreparedStatement s=sql("SELECT target FROM am_link WHERE tenant=? AND workspace=? AND relation=? AND source=? ORDER BY target",relation,source); ResultSet r=s.executeQuery()) {
                Set<String> out=new TreeSet<>();
                while(r.next())out.add(r.getString(1));
                return out;
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
        public void links(String relation,String source,Set<String> targets) {
            writable();
            try(PreparedStatement s=sql("DELETE FROM am_link WHERE tenant=? AND workspace=? AND relation=? AND source=?",relation,source)) {
                s.executeUpdate();
            }
            catch(SQLException e) {
                throw fail(e);
            }
            try(PreparedStatement s=c.prepareStatement("INSERT INTO am_link(tenant,workspace,relation,source,target) VALUES(?,?,?,?,?)")) {
                for(String target:targets) {
                    s.setString(1,space.tenant());
                    s.setString(2,space.workspace());
                    s.setString(3,relation);
                    s.setString(4,source);
                    s.setString(5,target);
                    s.addBatch();
                }
                s.executeBatch();
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
        public Event event(long at,String actor,String type,Map<String,Object> body) {
            writable();
            try {
                long seq;
                try(PreparedStatement s=sql("UPDATE am_workspace SET sequence=sequence+1 WHERE tenant=? AND workspace=? RETURNING sequence"); ResultSet r=s.executeQuery()) {
                    if(!r.next())throw new IllegalStateException("Workspace missing");
                    seq=r.getLong(1);
                }
                try(PreparedStatement s=sql("INSERT INTO am_event(tenant,workspace,sequence,at_ms,actor,type,body) VALUES(?,?,?,?,?,?,?)",seq,at,actor,type,Json.write(body))) {
                    s.executeUpdate();
                }
                return new Event(seq,at,actor,type,Json.copy(body));
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
        public List<Event> events(long after,int limit) {
            try(PreparedStatement s=sql("SELECT sequence,at_ms,actor,type,body FROM am_event WHERE tenant=? AND workspace=? AND sequence>? ORDER BY sequence LIMIT ?",after,limit); ResultSet r=s.executeQuery()) {
                List<Event> out=new ArrayList<>();
                while(r.next())out.add(new Event(r.getLong(1),r.getLong(2),r.getString(3),r.getString(4),Json.map(Json.parse(r.getString(5)))));
                return out;
            }
            catch(SQLException e) {
                throw fail(e);
            }
        }
    }
}
