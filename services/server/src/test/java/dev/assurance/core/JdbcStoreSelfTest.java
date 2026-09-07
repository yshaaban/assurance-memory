package dev.assurance.core;
import javax.sql.DataSource;
import java.io.PrintWriter;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import static dev.assurance.core.Json.*;
/** Real PostgreSQL integration test. Run with mvn -Ppostgres-it verify and a disposable database.
* No embedded substitute is used: row locking, repeatable reads and persistence require PostgreSQL. */
public final class JdbcStoreSelfTest {
    private static int assertions;
    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) throws Exception {
        String url = required("JDBC_URL"), user = required("DB_USER"), password = required("DB_PASSWORD");
        DataSource dataSource = new DriverDataSource(url, user, password);
        JdbcStore first = new JdbcStore(dataSource);
        first.migrate();
        Store.Space space = new Store.Space("jdbc-test", UUID.randomUUID().toString());
        first.write(space, tx -> {
            tx.put("example", "value", 0, obj("n", 1));
            tx.event(1, "test", "CREATED", obj());
            tx.links("test", "source", Set.of("target"));
            return null;
        });
        JdbcStore second = new JdbcStore(dataSource);
        second.migrate();
        check(second.read(space, tx -> num(tx.require("example", "value").body(), "n", 0)) == 1, "Persistence across store instances");
        check(second.read(space, tx -> tx.incoming("test", "target")).contains("source"), "Reverse edge persistence");
        check(second.read(new Store.Space("other-tenant", space.workspace()), tx -> tx.get("example", "value").isEmpty()), "Tenant isolation");
        try {
            first.write(space, tx -> {
                tx.put("example", "value", 1, obj("n", 99));
                tx.event(2, "test", "ROLLED_BACK", obj());
                throw new IllegalStateException("deliberate rollback");
            });
        }
        catch (IllegalStateException expected) {
            /* transaction must roll back */
        }
        check(first.read(space, tx -> tx.require("example", "value").version()) == 1, "Version rolls back");
        check(first.read(space, tx -> tx.events(0, 20).size()) == 1, "Audit event rolls back with data");
        AtomicInteger winners = new AtomicInteger();
        try (ExecutorService pool = Executors.newFixedThreadPool(12)) {
            List<Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < 12; i++) futures.add(pool.submit(() -> {
                try {
                    second.write(space, tx -> {
                        tx.put("example", "value", 1, obj("n", 2));
                        return null;
                    });
                    winners.incrementAndGet();
                }
                catch (Problem conflict) {
                    if (conflict.status != 409) throw conflict;
                }
            }));
            for (Future<?> future : futures) future.get(30, TimeUnit.SECONDS);
        }
        check(winners.get() == 1, "Exactly one concurrent compare-and-set writer succeeds");
        first.read(space, read -> {
            long old = read.require("example", "value").version();
            second.write(space, write -> {
                write.put("example", "value", old, obj("n", 3));
                return null;
            });
            check(read.require("example", "value").version() == old, "Repeatable-read snapshot remains stable");
            return null;
        });
        check(first.read(space, tx -> tx.require("example", "value").version()) == 3, "New transaction sees committed update");
        check(first.write(space, tx -> tx.event(3, "test", "NEXT", obj()).sequence()) == 2, "Rolled-back event did not consume committed sequence");
        first.write(space, tx -> {
            for (int i = 0; i < 10; i++) tx.put("page", String.format("%02d", i), 0, obj("i", i));
            return null;
        });
        check(first.read(space, tx -> tx.page("page", "03", 2)).stream().map(Store.Doc::id).toList().equals(List.of("04", "05")), "Keyset pagination");
        System.out.println("POSTGRES_VERIFICATION assertions=" + assertions + " workspace=" + space.workspace());
    }
    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required for PostgreSQL integration tests");
        return value;
    }
    private record DriverDataSource(String url, String user, String password) implements DataSource {
        public Connection getConnection() throws SQLException {
            return DriverManager.getConnection(url, user, password);
        }
        public Connection getConnection(String username, String secret) throws SQLException {
            return DriverManager.getConnection(url, username, secret);
        }
        public PrintWriter getLogWriter() {
            return null;
        }
        public void setLogWriter(PrintWriter ignored) {
        }
        public void setLoginTimeout(int seconds) {
            DriverManager.setLoginTimeout(seconds);
        }
        public int getLoginTimeout() {
            return DriverManager.getLoginTimeout();
        }
        public Logger getParentLogger() {
            return Logger.getLogger("dev.assurance.jdbc.test");
        }
        public <T> T unwrap(Class<T> iface) throws SQLException {
            if (iface.isInstance(this)) return iface.cast(this);
            throw new SQLException("Unsupported unwrap");
        }
        public boolean isWrapperFor(Class<?> iface) {
            return iface.isInstance(this);
        }
    }
}
