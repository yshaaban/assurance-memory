package dev.assurance.core;
import java.util.*;
import java.util.function.Function;
/** Per-workspace atomic writes; all returned documents are defensive copies. */ public interface Store {
    record Space(String tenant,String workspace) {
    }
    record Doc(String id,long version,Map<String,Object> body) {
    }
    record Event(long sequence,long at,String actor,String type,Map<String,Object> body) {
    }
    interface Tx {
        Optional<Doc> get(String kind,String id);
        List<Doc> page(String kind,String after,int limit);
        void put(String kind,String id,long expectedVersion,Map<String,Object> body);
        void delete(String kind,String id,long expectedVersion);
        Set<String> incoming(String relation,String target);
        Set<String> outgoing(String relation,String source);
        void links(String relation,String source,Set<String> targets);
        Event event(long at,String actor,String type,Map<String,Object> body);
        List<Event> events(long after,int limit);
        default Doc require(String kind,String id) {
            return get(kind,id).orElseThrow(()->Problem.missing(kind+" not found"));
        }
        default List<Doc> all(String kind,int max) {
            List<Doc> result=new ArrayList<>();
            String cursor="";
            while(true) {
                List<Doc> batch=page(kind,cursor,Math.min(500,max+1-result.size()));
                result.addAll(batch);
                if(result.size()>max)throw new Problem(413,"PARTITION_LIMIT","Partition limit reached; split the component/workspace");
                if(batch.size()<Math.min(500,max+1-(result.size()-batch.size())))break;
                cursor=batch.getLast().id();
            }
            return result;
        }
        default void upsert(String kind,String id,Map<String,Object> body) {
            put(kind,id,get(kind,id).map(Doc::version).orElse(0L),body);
        }
    }
    <T>T write(Space space,Function<Tx,T> action);
    <T>T read(Space space,Function<Tx,T> action);
    List<Space> spaces();
}
