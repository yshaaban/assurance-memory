package dev.assurance.core;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Function;
/** Transactional, copy-on-write test/development store. Not durable and never selected in production. */ public final class MemoryStore implements Store {
    private record Key(String kind,String id) implements Comparable<Key> {
        public int compareTo(Key k) {
            int c=kind.compareTo(k.kind);
            return c!=0?c:id.compareTo(k.id);
        }
    }
    private record Link(String relation,String source) {
    }
    private static final class Data {
        final ReentrantReadWriteLock lock=new ReentrantReadWriteLock();
        final NavigableMap<Key,Doc> docs=new TreeMap<>();
        final Map<Link,Set<String>> links=new HashMap<>();
        final List<Event> events=new ArrayList<>();
    }
    private final Map<Space,Data> data=new ConcurrentHashMap<>();
    public <T>T write(Space s,Function<Tx,T> fn) {
        Data d=data.computeIfAbsent(s,k->new Data());
        d.lock.writeLock().lock();
        try {
            MemoryTx tx=new MemoryTx(d,false);
            T result=fn.apply(tx);
            tx.commit();
            return result;
        }
        finally {
            d.lock.writeLock().unlock();
        }
    }
    public <T>T read(Space s,Function<Tx,T> fn) {
        Data d=data.computeIfAbsent(s,k->new Data());
        d.lock.readLock().lock();
        try {
            return fn.apply(new MemoryTx(d,true));
        }
        finally {
            d.lock.readLock().unlock();
        }
    }
    public List<Space> spaces() {
        return List.copyOf(data.keySet());
    }
    private static final class MemoryTx implements Tx {
        private final Data data;
        private final boolean readOnly;
        private final NavigableMap<Key,Doc> changes=new TreeMap<>();
        private final Set<Key> deleted=new HashSet<>();
        private final Map<Link,Set<String>> linkChanges=new HashMap<>();
        private final List<Event> newEvents=new ArrayList<>();
        MemoryTx(Data d,boolean r) {
            data=d;
            readOnly=r;
        }
        private void writable() {
            if(readOnly)throw new IllegalStateException("Read transaction mutated");
        }
        public Optional<Doc> get(String k,String id) {
            Key key=new Key(k,id);
            if(deleted.contains(key))return Optional.empty();
            Doc d=changes.containsKey(key)?changes.get(key):data.docs.get(key);
            return d==null?Optional.empty():Optional.of(new Doc(d.id(),d.version(),Json.copy(d.body())));
        }
        public List<Doc> page(String kind,String after,int limit) {
            Problem.require(limit>0&&limit<=1000,"Page limit must be 1..1000");
            NavigableMap<Key,Doc> merged=new TreeMap<>(data.docs.subMap(new Key(kind,""),true,new Key(kind+"\u0000",""),false));
            for(var e:changes.entrySet())if(e.getKey().kind.equals(kind))merged.put(e.getKey(),e.getValue());
            deleted.forEach(merged::remove);
            return merged.tailMap(new Key(kind,after),false).values().stream().limit(limit).map(d->new Doc(d.id(),d.version(),Json.copy(d.body()))).toList();
        }
        public void put(String k,String id,long expected,Map<String,Object> body) {
            writable();
            long actual=get(k,id).map(Doc::version).orElse(0L);
            if(expected!=actual)throw Problem.conflict("Version changed");
            Key key=new Key(k,id);
            changes.put(key,new Doc(id,actual+1,Json.copy(body)));
            deleted.remove(key);
        }
        public void delete(String k,String id,long expected) {
            writable();
            if(get(k,id).map(Doc::version).orElse(0L)!=expected)throw Problem.conflict("Version changed");
            Key key=new Key(k,id);
            deleted.add(key);
            changes.remove(key);
        }
        public Set<String> incoming(String r,String target) {
            Map<Link,Set<String>> all=new HashMap<>(data.links);
            all.putAll(linkChanges);
            Set<String> out=new TreeSet<>();
            all.forEach((k,v)-> {
                if(k.relation.equals(r)&&v.contains(target))out.add(k.source);
            });
            return out;
        }
        public Set<String> outgoing(String r,String source) {
            return Set.copyOf(linkChanges.getOrDefault(new Link(r,source),data.links.getOrDefault(new Link(r,source),Set.of())));
        }
        public void links(String r,String source,Set<String> targets) {
            writable();
            linkChanges.put(new Link(r,source),Set.copyOf(targets));
        }
        public Event event(long at,String actor,String type,Map<String,Object> body) {
            writable();
            Event e=new Event(data.events.size()+newEvents.size()+1L,at,actor,type,Json.copy(body));
            newEvents.add(e);
            return e;
        }
        public List<Event> events(long after,int limit) {
            return java.util.stream.Stream.concat(data.events.stream(),newEvents.stream()).filter(e->e.sequence()>after).limit(limit).map(e->new Event(e.sequence(),e.at(),e.actor(),e.type(),Json.copy(e.body()))).toList();
        }
        void commit() {
            deleted.forEach(data.docs::remove);
            data.docs.putAll(changes);
            data.links.putAll(linkChanges);
            data.events.addAll(newEvents);
        }
    }
}
