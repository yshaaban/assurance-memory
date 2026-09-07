package dev.assurance.core;
import java.util.*;
import static dev.assurance.core.Json.*;
/** Checks a forbidden causal order within (entity, executionEpoch). Never orders events by wall clock.
* Missing parents, disconnected traces and absent instrumentation cannot establish safety. */
public final class TraceChecker {
    public Map<String,Object> check(Map<String,Object> request) {
        String first=str(request,"first"),later=str(request,"later");
        List<Object> raw=list(request,"events");
        Problem.require(raw.size()<=10_000,"Trace limit is 10000 events");
        Map<String,Map<String,Object>> events=new LinkedHashMap<>();
        for(Object o:raw) {
            Map<String,Object> e=map(o);
            String id=id(e,"id");
            str(e,"entity");
            str(e,"executionEpoch");
            str(e,"kind");
            Problem.require(events.putIfAbsent(id,e)==null,"Duplicate event ID");
        }
        List<String> gaps=new ArrayList<>();
        Map<String,Integer> indegree=new HashMap<>();
        Map<String,List<String>> children=new HashMap<>();
        for(var e:events.entrySet()) {
            Set<String> parents=new HashSet<>(strings(e.getValue(),"parents"));
            int count=0;
            for(String p:parents) {
                if(!events.containsKey(p)) {
                    gaps.add(e.getKey()+"<-"+p);
                    continue;
                }
                count++;
                children.computeIfAbsent(p,k->new ArrayList<>()).add(e.getKey());
            }
            indegree.put(e.getKey(),count);
        }
        ArrayDeque<String> queue=new ArrayDeque<>();
        indegree.forEach((k,v)-> {
            if(v==0)queue.add(k);
        });
        Map<String,Map<String,String>> ancestors=new HashMap<>();
        int visited=0;
        while(!queue.isEmpty()) {
            String id=queue.removeFirst();
            visited++;
            Map<String,Object> e=events.get(id);
            Map<String,String> prior=ancestors.computeIfAbsent(id,k->new HashMap<>());
            String identity=hash(List.of(str(e,"entity"),str(e,"executionEpoch")));
            if(str(e,"kind").equals(later)&&prior.containsKey(identity))return obj("status","OBSERVED_VIOLATION","firstEvent",prior.get(identity),"laterEvent",id,"entity",str(e,"entity"),"executionEpoch",str(e,"executionEpoch"),"missingParents",gaps);
            if(str(e,"kind").equals(first))prior.put(identity,id);
            for(String child:children.getOrDefault(id,List.of())) {
                Map<String,String> a=ancestors.computeIfAbsent(child,k->new HashMap<>());
                a.putAll(prior);
                Problem.require(a.size()<=10_000,"Causal context limit exceeded");
                if(indegree.merge(child,-1,Integer::sum)==0)queue.add(child);
            }
        }
        Problem.require(visited==events.size(),"Causal graph contains a cycle");
        return obj("status",gaps.isEmpty()?"NOT_OBSERVED":"INCONCLUSIVE","missingParents",gaps,"limitations",List.of("No absence-of-violation guarantee","Concurrent or unlinked events are not ordered","Instrumentation completeness must be established independently"));
    }
}
