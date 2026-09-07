package dev.assurance.core;
import java.util.*;
import static dev.assurance.core.Json.*;
/** Explicit-state safety checker for finite communicating machines.
* State variables may encode parallel/hierarchical machine locations, epochs, ownership, and counters.
* Guards and simultaneous assignments use a closed expression language; there is no eval or source execution.
* A complete search establishes only the supplied model's safety, never implementation conformance or liveness. */
public final class ModelChecker {
    private record Node(String key,Map<String,Object> state,String parent,String via,int depth) {
    }
    public Map<String,Object> check(Map<String,Object> model) {
        Problem.require(Set.of("initial","domains","transitions","invariants","maxStates","maxDepth","terminal","deadlockIsViolation","description").containsAll(model.keySet()),"Unknown model field; do not silently weaken a misspelled contract");
        Map<String,Object> initial=normalize(child(model,"initial")),domains=child(model,"domains");
        Problem.require(!initial.isEmpty()&&initial.size()<=100,"Model must declare 1..100 state variables");
        Problem.require(initial.keySet().equals(domains.keySet()),"Every variable must have a finite domain");
        for(var e:domains.entrySet()) {
            List<Object> values=list(e.getValue());
            Problem.require(!values.isEmpty()&&values.size()<=128,"Domain size must be 1..128");
            for(Object v:values)scalar(v);
        }
        validateState(initial,domains);
        List<Map<String,Object>> transitions=list(model,"transitions").stream().map(Json::map).toList();
        List<Map<String,Object>> invariants=list(model,"invariants").stream().map(Json::map).toList();
        Problem.require(!invariants.isEmpty()&&invariants.size()<=100,"Declare 1..100 safety invariants");
        Problem.require(transitions.size()<=1000,"Too many transitions");
        Set<String> ids=new HashSet<>();
        for(var t:transitions) {
            Problem.require(Set.of("id","when","set","description").containsAll(t.keySet()),"Unknown transition field");
            Problem.require(ids.add(id(t,"id")),"Duplicate transition ID");
            validateExpr(t.getOrDefault("when",true),initial.keySet(),0);
            Map<String,Object> assignments=child(t,"set");
            Problem.require(initial.keySet().containsAll(assignments.keySet()),"Transition writes an undeclared variable");
            assignments.values().forEach(x->validateExpr(x,initial.keySet(),0));
        }
        ids.clear();
        for(var i:invariants) {
            Problem.require(Set.of("id","predicate","description").containsAll(i.keySet()),"Unknown invariant field");
            Problem.require(ids.add(id(i,"id")),"Duplicate invariant ID");
            Problem.require(i.containsKey("predicate"),"Invariant needs predicate");
            validateExpr(i.get("predicate"),initial.keySet(),0);
        }
        if(model.containsKey("terminal"))validateExpr(model.get("terminal"),initial.keySet(),0);
        int maxStates=(int)num(model,"maxStates",20_000),maxDepth=(int)num(model,"maxDepth",100);
        Problem.require(maxStates>0&&maxStates<=100_000&&maxDepth>=0&&maxDepth<=1000,"Search bounds exceeded");
        Map<String,Node> seen=new LinkedHashMap<>();
        ArrayDeque<Node> queue=new ArrayDeque<>();
        Node root=new Node(hash(initial),initial,null,null,0);
        seen.put(root.key,root);
        queue.add(root);
        Set<String> exercised=new TreeSet<>();
        boolean truncated=false;
        int deadlocks=0;
        long started=System.nanoTime();
        while(!queue.isEmpty()) {
            if(System.nanoTime()-started>10_000_000_000L) {
                truncated=true;
                break;
            }
            Node node=queue.removeFirst();
            for(var invariant:invariants)if(!truth(eval(invariant.get("predicate"),node.state))) {
                return result("COUNTEREXAMPLE",seen.size(),deadlocks,exercised,transitions,trace(node,seen),str(invariant,"id"),node.state);
            }
            int enabled=0;
            for(var t:transitions) {
                if(!truth(eval(t.getOrDefault("when",true),node.state)))continue;
                enabled++;
                exercised.add(str(t,"id"));
                Map<String,Object> next=new LinkedHashMap<>(node.state);
                child(t,"set").forEach((k,v)->next.put(k,scalar(eval(v,node.state))));
                validateState(next,domains);
                String key=hash(next);
                if(seen.containsKey(key))continue;
                if(node.depth>=maxDepth||seen.size()>=maxStates) {
                    truncated=true;
                    continue;
                }
                Node child=new Node(key,next,node.key,str(t,"id"),node.depth+1);
                seen.put(key,child);
                queue.addLast(child);
            }
            if(enabled==0&&!truth(eval(model.getOrDefault("terminal",false),node.state))) {
                deadlocks++;
                if(bool(model,"deadlockIsViolation",false))return result("COUNTEREXAMPLE",seen.size(),deadlocks,exercised,transitions,trace(node,seen),"nonterminal-deadlock",node.state);
            }
        }
        return result(truncated?"INCONCLUSIVE":"MODEL_SATISFIED",seen.size(),deadlocks,exercised,transitions,List.of(),null,null);
    }
    private Map<String,Object> result(String status,int explored,int deadlocks,Set<String> exercised,List<Map<String,Object>> transitions,List<Object> trace,String invariant,Map<String,Object> state) {
        return obj("status",status,"exploredStates",explored,"deadlocks",deadlocks,"counterexample",trace,"violatedInvariant",invariant,"state",state,"unexercisedTransitions",transitions.stream().map(t->str(t,"id")).filter(x->!exercised.contains(x)).toList(),"limitations",List.of("Safety only; no fairness or unbounded liveness proof","The model-to-implementation binding is a separate obligation","Domains, environment assumptions and transition atomicity are supplied by the model author"));
    }
    private List<Object> trace(Node n,Map<String,Node> seen) {
        LinkedList<Object> result=new LinkedList<>();
        while(n!=null) {
            result.addFirst(obj("transition",n.via,"state",n.state));
            n=n.parent==null?null:seen.get(n.parent);
        }
        return result;
    }
    private Map<String,Object> normalize(Map<String,Object> m) {
        Map<String,Object> out=new TreeMap<>();
        m.forEach((k,v)->out.put(k,scalar(v)));
        return out;
    }
    private static Object scalar(Object v) {
        if(v instanceof Boolean||v instanceof String)return v;
        if(v instanceof Number n&&Double.isFinite(n.doubleValue())&&n.doubleValue()==n.longValue()&&Math.abs(n.doubleValue())<=9_007_199_254_740_991d)return n.longValue();
        throw Problem.bad("Model values must be booleans, strings or safe integers");
    }
    private static void validateState(Map<String,Object> state,Map<String,Object> domains) {
        for(var e:state.entrySet())Problem.require(list(domains.get(e.getKey())).stream().anyMatch(v->same(v,e.getValue())),"State assignment leaves a declared finite domain: "+e.getKey());
    }
    private static boolean same(Object a,Object b) {
        if(a instanceof Number x&&b instanceof Number y)return Double.compare(x.doubleValue(),y.doubleValue())==0;
        return Objects.equals(a,b);
    }
    private static boolean truth(Object v) {
        if(!(v instanceof Boolean b))throw Problem.bad("Boolean expression required");
        return b;
    }
    private static long integer(Object v) {
        if(!(v instanceof Number n)||n.doubleValue()!=n.longValue())throw Problem.bad("Integer expression required");
        return n.longValue();
    }
    private static void validateExpr(Object e,Set<String> variables,int depth) {
        Problem.require(depth<=32,"Expression nesting limit exceeded");
        if(!(e instanceof Map<?,?>)) {
            scalar(e);
            return;
        }
        Map<String,Object> m=map(e);
        if(m.containsKey("var")) {
            Problem.require(m.size()==1&&variables.contains(str(m,"var")),"Unknown variable");
            return;
        }
        Problem.require(Set.of("op","args").containsAll(m.keySet()),"Unknown expression field");
        String op=str(m,"op");
        List<Object>a=list(m,"args");
        Problem.require(Set.of("and","or","not","eq","ne","lt","le","gt","ge","add","sub").contains(op),"Unsupported expression operator");
        Problem.require((Set.of("and","or").contains(op)&&!a.isEmpty()&&a.size()<=100)||(op.equals("not")&&a.size()==1)||(!Set.of("and","or","not").contains(op)&&a.size()==2),"Wrong expression arity");
        a.forEach(x->validateExpr(x,variables,depth+1));
    }
    private static Object eval(Object e,Map<String,Object> state) {
        if(!(e instanceof Map<?,?>))return e;
        Map<String,Object> m=map(e);
        if(m.containsKey("var"))return state.get(str(m,"var"));
        String op=str(m,"op");
        List<Object>a=list(m,"args");
        if(op.equals("and"))return a.stream().allMatch(x->truth(eval(x,state)));
        if(op.equals("or"))return a.stream().anyMatch(x->truth(eval(x,state)));
        if(op.equals("not"))return !truth(eval(a.getFirst(),state));
        Object x=eval(a.get(0),state),y=eval(a.get(1),state);
        return switch(op) {
            case "eq"->same(x,y);
            case "ne"->!same(x,y);
            case "lt"->integer(x)<integer(y);
            case "le"->integer(x)<=integer(y);
            case "gt"->integer(x)>integer(y);
            case "ge"->integer(x)>=integer(y);
            case "add"->Math.addExact(integer(x),integer(y));
            case "sub"->Math.subtractExact(integer(x),integer(y));
            default->throw Problem.bad("Unsupported expression");
        };
    }
}
