package dev.assurance.core;

import java.util.*;
import static dev.assurance.core.Json.*;

/** Bounded, read-only work discovery over reviewed arguments. It never creates or discharges a claim. */
final class Frontier {
    private Frontier() {}

    static Map<String,Object> read(Kernel.Ctx c, Map<String,Object> request) {
        String root = id(request, "id");
        int limit = Kernel.limit(request);
        long budget = num(request, "maxClaims", 500);
        Problem.require(budget >= 1 && budget <= 5000, "maxClaims must be 1..5000");
        Map<String,Map<String,Object>> heads = new TreeMap<>(), definitions = new TreeMap<>();
        Map<String,List<Map<String,Object>>> arguments = new TreeMap<>();
        Deque<String> todo = new ArrayDeque<>();
        todo.add(root);
        int edgeCount = 0;
        while (!todo.isEmpty()) {
            String id = todo.removeFirst();
            if (heads.containsKey(id)) continue;
            Problem.require(heads.size() < budget, "Mission exceeds maxClaims; select a smaller root or increase the explicit budget");
            Map<String,Object> head = c.tx().require("claimHead", id).body();
            heads.put(id, head);
            definitions.put(id, Claims.claim(c,id));
            List<Map<String,Object>> current = new ArrayList<>();
            for (String aid : new TreeSet<>(c.tx().incoming("argumentFor",id))) {
                Map<String,Object> argument = c.tx().require("argument",aid).body();
                if (num(child(argument,"conclusion"),"revision",0) != num(head,"revision",0)) continue;
                current.add(argument);
                for (Object raw : list(argument,"premises")) {
                    Problem.require(++edgeCount <= 20000, "Mission argument edge budget exceeded");
                    todo.addLast(str(map(raw),"id"));
                }
            }
            arguments.put(id,current);
        }
        Map<String,Map<String,Object>> assessments = new HashMap<>();
        for (String id : heads.keySet()) Claims.assess(c,id,new HashSet<>(),assessments);
        // Traverse only unresolved routes; a supported alternative does not create unnecessary work.
        Set<String> relevant = new TreeSet<>();
        todo.add(root);
        while (!todo.isEmpty()) {
            String id = todo.removeFirst();
            if (str(assessments.get(id),"status").equals("SUPPORTED") || !relevant.add(id)) continue;
            for (var argument : arguments.get(id)) for (Object raw : list(argument,"premises")) {
                Map<String,Object> pin = map(raw);
                String child = str(pin,"id");
                if (num(pin,"revision",0) == num(heads.get(child),"revision",0)) todo.addLast(child);
            }
        }
        List<Object> items = new ArrayList<>();
        for (String id : relevant) {
            Map<String,Object> assessment = assessments.get(id), definition = definitions.get(id);
            List<Object> alternatives = new ArrayList<>();
            for (var argument : arguments.get(id)) {
                List<Object> blockers = new ArrayList<>();
                for (Object raw : list(argument,"premises")) {
                    Map<String,Object> pin = map(raw);
                    String child = str(pin,"id");
                    if (num(pin,"revision",0) != num(heads.get(child),"revision",0))
                        blockers.add(obj("id",child,"action","REVIEW_ARGUMENT_REVISION","pinnedRevision",pin.get("revision"),"currentRevision",heads.get(child).get("revision")));
                    else if (!str(assessments.get(child),"status").equals("SUPPORTED"))
                        blockers.add(obj("id",child,"action","RESOLVE_PREMISE","status",assessments.get(child).get("status")));
                }
                alternatives.add(obj("argumentId",argument.get("id"),"allRequired",blockers));
            }
            List<String> reasons = list(assessment,"reasons").stream().map(raw -> str(map(raw),"kind")).distinct().sorted().toList();
            boolean ownWork = reasons.stream().anyMatch(kind -> !kind.equals("NO_SUPPORTED_ARGUMENT"));
            String action = ownWork ? "CHECK_OR_REPAIR_LOCAL_OBLIGATION" : alternatives.isEmpty() ? "PROPOSE_REVIEWED_DECOMPOSITION" : "RESOLVE_ARGUMENT_ALTERNATIVE";
            items.add(obj("id",id,"revision",heads.get(id).get("revision"),"generation",heads.get(id).get("generation"),
                "statement",definition.get("statement"),"owner",definition.get("owner"),"status",assessment.get("status"),
                "action",action,"reasonKinds",reasons,"alternatives",alternatives,"checks",definition.get("checks")));
        }
        String fingerprint = hash(obj("heads",heads,"items",items,"rootStatus",assessments.get(root).get("status")));
        String expected = str(request,"fingerprint","");
        if (!expected.isEmpty() && !expected.equals(fingerprint)) throw Problem.conflict("Mission frontier changed; restart pagination");
        String after = str(request,"after","");
        Problem.require(after.isEmpty() || !expected.isEmpty(), "Continuation requires its frontier fingerprint");
        List<Object> remaining = items.stream().filter(raw -> str(map(raw),"id").compareTo(after)>0).toList();
        List<Object> page = remaining.stream().limit(limit).toList();
        return obj("root",root,"rootStatus",assessments.get(root).get("status"),"fingerprint",fingerprint,
            "items",page,"hasMore",remaining.size()>limit,"next",page.isEmpty()?after:str(map(page.getLast()),"id"),
            "reachableClaims",heads.size(),"unresolvedClaims",items.size(),"truncated",false,
            "meaning","Work discovery only. Every premise in one argument is required; alternative arguments are OR routes. Reviewed rationale is not a kernel-checked software refinement proof.");
    }
}
