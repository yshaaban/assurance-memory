package dev.assurance.core;
import java.util.*;
import static dev.assurance.core.Json.*;
/** Immutable approved claims, reviewed AND/OR arguments, evidence generations, and fenced checker work. */ final class Claims {
    private Claims() {
    }
    static long policyEpoch(Kernel.Ctx c) {
        return c.tx().get("meta","policy").map(d->num(d.body(),"epoch",0)).orElse(0L);
    }
    static void changePolicy(Kernel.Ctx c) {
        c.tx().upsert("meta","policy",obj("epoch",policyEpoch(c)+1));
    }
    static Map<String,Object> propose(Kernel.Ctx c,Map<String,Object> r) {
        Problem.require(write(r).length()<=50_000,"Proposal too large");
        String id=c.uuid();
        Map<String,Object> proposal=obj("id",id,"proposal",r,"proposedBy",c.actor().id(),"at",c.now(),"authority","PROPOSED","trust","UNTRUSTED_AGENT_CONTENT");
        c.tx().put("proposal",id,0,proposal);
        c.event("CLAIM_PROPOSED",obj("id",id));
        return proposal;
    }
    static Map<String,Object> approve(Kernel.Ctx c,Map<String,Object> r) {
        String id=id(r,"id");
        Optional<Store.Doc> existing=c.tx().get("claimHead",id);
        long current=existing.map(d->num(d.body(),"revision",0)).orElse(0L);
        if(num(r,"expectedRevision",0)!=current)throw Problem.conflict("Requirement revision changed; approval must be reviewed again");
        List<String> components=strings(r,"components").stream().distinct().sorted().toList();
        Problem.require(!components.isEmpty()&&components.size()<=100&&components.stream().allMatch(x->x.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,49}")),"Declare 1..100 valid components");
        List<String> watch=new ArrayList<>(strings(r,"watch"));
        Problem.require(!watch.isEmpty()&&watch.size()<=2000,"Declare a bounded semantic dependency footprint");
        String quantification=str(r,"quantification","ALL_MATCHING");
        Problem.require(Set.of("ALL_MATCHING","EXACT_SUBJECTS").contains(quantification),"Invalid quantification");
        for(String key:watch) {
            String[] parts=key.split(":",3);
            Problem.require(parts.length>=2&&Set.of("component","subject","scope","context").contains(parts[0])&&components.contains(parts[1])&&key.length()<=240,"Invalid watch selector");
            Problem.require((Set.of("component","context").contains(parts[0])&&parts.length==2)||(parts[0].equals("scope")&&parts.length==3&&parts[2].matches("[A-Za-z0-9_.-]{1,80}"))||(parts[0].equals("subject")&&parts.length==3&&parts[2].matches("[a-f0-9]{64}")),"Malformed watch selector");
        }
        for(String component:components) {
            boolean scoped=watch.stream().anyMatch(k->k.equals("component:"+component)||k.startsWith("scope:"+component+":"));
            boolean exact=watch.stream().anyMatch(k->k.startsWith("subject:"+component+":"));
            Problem.require(scoped||(!quantification.equals("ALL_MATCHING")&&exact),"Universal/negative claims require a component or query-scope dependency, including future members");
            watch.add("context:"+component);
        }
        watch=watch.stream().distinct().sorted().toList();
        String mode=str(r,"mode","DIRECT");
        Problem.require(Set.of("DIRECT","DECOMPOSED","BOTH").contains(mode),"Invalid argument mode");
        List<Map<String,Object>> checks=new ArrayList<>();
        Set<String> checkIds=new HashSet<>();
        for(Object raw:list(r,"checks")) {
            Map<String,Object> check=map(raw);
            String cid=id(check,"id");
            Problem.require(checkIds.add(cid),"Duplicate check ID");
            String kind=str(check,"kind");
            Problem.require(Set.of("STATIC","TEST","MODEL","BENCHMARK","TRACE","REVIEW").contains(kind),"Invalid evidence kind");
            long age=num(check,"maxAgeSeconds",86400);
            Problem.require(age>=1&&age<=31_536_000,"Evidence maxAgeSeconds must be 1..31536000");
            checks.add(obj("id",cid,"kind",kind,"checker",id(check,"checker"),"version",text(check,"version",100),"maxAgeSeconds",age));
        }
        Problem.require(checks.size()<=20&&(mode.equals("DECOMPOSED")||!checks.isEmpty()),"Direct claims require 1..20 evidence checks");
        long revision=current+1,generation=existing.map(d->num(d.body(),"generation",0)).orElse(0L)+1;
        Map<String,Object> claim=obj("id",id,"revision",revision,"statement",text(r,"statement",12_000),"owner",text(r,"owner",120),"components",components,"watch",watch,"quantification",quantification,"checks",checks,"mode",mode,"critical",bool(r,"critical",true),"allowPartialAnalysis",bool(r,"allowPartialAnalysis",false),"definitions",child(r,"definitions"),"sources",list(r,"sources"),"approvedBy",c.actor().id(),"approvedAt",c.now(),"authority","APPROVED");
        Problem.require(write(claim).length()<=100_000,"Claim is too large");
        claim.put("statementDigest",hash(claim));
        c.tx().put("claim",ref(id,revision),0,claim);
        Map<String,Object> head=obj("id",id,"revision",revision,"generation",generation,"at",c.now(),"lastInvalidation",obj("reason","REQUIREMENT_APPROVED","at",c.now()));
        c.tx().upsert("claimHead",id,head);
        c.tx().links("watch",id,new HashSet<>(watch.stream().map(Json::sha).toList()));
        c.tx().links("componentClaim",id,new HashSet<>(components));
        c.tx().links("parent",id,Set.of());
        changePolicy(c);
        schedule(c,claim,head);
        invalidate(c,c.tx().incoming("parent",id),"PREMISE_REVISION_CHANGED",obj("claim",id,"revision",revision));
        c.event("CLAIM_APPROVED",obj("id",id,"revision",revision,"statementDigest",claim.get("statementDigest")));
        return obj("claim",claim,"head",head);
    }
    static String ref(String id,long revision) {
        return id+"@"+revision;
    }
    static Map<String,Object> claim(Kernel.Ctx c,String id) {
        Map<String,Object> h=c.tx().require("claimHead",id).body();
        return c.tx().require("claim",ref(id,num(h,"revision",0))).body();
    }
    static Map<String,Object> argument(Kernel.Ctx c,Map<String,Object> r) {
        String id=id(r,"id");
        Map<String,Object> conclusion=child(r,"conclusion");
        String parent=id(conclusion,"id");
        Map<String,Object> head=c.tx().require("claimHead",parent).body();
        Problem.require(num(conclusion,"revision",0)==num(head,"revision",0),"Conclusion must reference the current approved revision");
        Problem.require(!str(claim(c,parent),"mode").equals("DIRECT"),"DIRECT claim does not use decomposition arguments");
        List<Object> premises=list(r,"premises");
        Problem.require(!premises.isEmpty()&&premises.size()<=100,"Arguments require 1..100 premises");
        Set<String> children=new TreeSet<>();
        for(Object p:premises) {
            Map<String,Object> pin=map(p);
            String child=id(pin,"id");
            Map<String,Object> childHead=c.tx().require("claimHead",child).body();
            Problem.require(num(pin,"revision",0)==num(childHead,"revision",0),"Premise must reference a current approved revision");
            Problem.require(children.add(child),"Duplicate premise");
            Problem.require(!reachable(c,child,parent,new HashSet<>()),"Circular arguments cannot establish assurance; supply a separately checked joint invariant");
        }
        Map<String,Object> argument=obj("id",id,"conclusion",conclusion,"premises",premises,"rule","ALL_PREMISES_SUFFICIENT","rationale",text(r,"rationale",8000),"reviewedBy",c.actor().id(),"at",c.now(),"limitations",strings(r,"limitations"));
        c.tx().put("argument",id,0,argument);
        c.tx().links("argumentFor",id,Set.of(parent));
        Set<String> links=new TreeSet<>(c.tx().outgoing("parent",parent));
        links.addAll(children);
        c.tx().links("parent",parent,links);
        changePolicy(c);
        invalidate(c,Set.of(parent),"ARGUMENT_APPROVED",obj("argument",id));
        c.event("ARGUMENT_APPROVED",obj("argument",id,"conclusion",parent));
        return argument;
    }
    private static boolean reachable(Kernel.Ctx c,String from,String goal,Set<String> visited) {
        if(from.equals(goal))return true;
        if(!visited.add(from))return false;
        Problem.require(visited.size()<=5000,"Argument graph exceeds workspace limit");
        for(String child:c.tx().outgoing("parent",from))if(reachable(c,child,goal,visited))return true;
        return false;
    }
    static Set<String> invalidate(Kernel.Ctx c,Set<String> roots,String reason,Map<String,Object> causes) {
        Set<String> visited=new TreeSet<>();
        ArrayDeque<String> todo=new ArrayDeque<>(roots);
        while(!todo.isEmpty()) {
            String id=todo.removeFirst();
            if(!visited.add(id))continue;
            Problem.require(visited.size()<=5000,"Invalidation fan-out exceeds workspace limit; partition the workspace");
            Optional<Store.Doc> d=c.tx().get("claimHead",id);
            if(d.isEmpty())continue;
            Map<String,Object> h=d.get().body();
            h.put("generation",num(h,"generation",0)+1);
            h.put("lastInvalidation",obj("reason",reason,"causes",causes,"at",c.now()));
            h.put("at",c.now());
            c.tx().put("claimHead",id,d.get().version(),h);
            schedule(c,claim(c,id),h);
            c.event("ASSURANCE_INVALIDATED",obj("claim",id,"revision",h.get("revision"),"generation",h.get("generation"),"reason",reason,"causes",causes));
            todo.addAll(c.tx().incoming("parent",id));
        }
        return visited;
    }
    private static Map<String,Object> dependencies(Kernel.Ctx c,Map<String,Object> claim) {
        Map<String,Object> out=new TreeMap<>();
        for(String key:strings(claim,"watch"))out.put(key,Scans.fingerprint(c,key));
        return out;
    }
    private static Map<String,Object> contexts(Kernel.Ctx c,Map<String,Object> claim) {
        Map<String,Object> out=new TreeMap<>();
        for(String component:strings(claim,"components"))c.tx().get("head",component).ifPresent(d->out.put(component,d.body()));
        return out;
    }
    private static void schedule(Kernel.Ctx c,Map<String,Object> claim,Map<String,Object> head) {
        for(Object o:list(claim,"checks")) {
            Map<String,Object> check=map(o);
            String id=sha(str(claim,"id")+":"+num(head,"revision",0)+":"+num(head,"generation",0)+":"+str(check,"id"));
            if(c.tx().get("job",id).isPresent())continue;
            Map<String,Object> job=obj("id",id,"claimId",claim.get("id"),"revision",head.get("revision"),"generation",head.get("generation"),"check",check,"dependencies",dependencies(c,claim),"contexts",contexts(c,claim),"state","QUEUED","fence",0L,"createdAt",c.now());
            c.tx().put("job",id,0,job);
            c.tx().links("queue",id,Set.of(str(check,"checker")));
            c.event("CHECK_QUEUED",obj("job",id,"claim",claim.get("id"),"checker",check.get("checker")));
        }
    }
    static Map<String,Object> recheck(Kernel.Ctx c,Map<String,Object> r) {
        String claimId=id(r,"id");
        Map<String,Object> claim=claim(c,claimId),head=c.tx().require("claimHead",claimId).body();
        schedule(c,claim,head);
        int queued=0;
        for(Object raw:list(claim,"checks")) {
            Map<String,Object> check=map(raw);
            String jid=sha(claimId+":"+num(head,"revision",0)+":"+num(head,"generation",0)+":"+str(check,"id"));
            Store.Doc d=c.tx().require("job",jid);
            Map<String,Object> job=d.body();
            if(str(job,"state").equals("RUNNING")&&num(job,"leaseUntil",0)>c.now())continue;
            job.put("state","QUEUED");
            job.put("runner","");
            job.put("leaseUntil",0L);
            job.put("dependencies",dependencies(c,claim));
            job.put("contexts",contexts(c,claim));
            c.tx().put("job",jid,d.version(),job);
            c.tx().links("queue",jid,Set.of(str(check,"checker")));
            queued++;
        }
        c.event("RECHECK_REQUESTED",obj("claim",claimId,"queued",queued));
        return obj("claimId",claimId,"queued",queued);
    }
    static Map<String,Object> claimJob(Kernel.Ctx c,Map<String,Object> r) {
        Set<String> permitted=c.actor().checkers();
        List<String> requested=strings(r,"checkers");
        if(requested.isEmpty())requested=new ArrayList<>(permitted);
        if(requested.isEmpty()||!permitted.containsAll(requested))throw new Problem(403,"FORBIDDEN","Checker is not authorized for this runner");
        long ttl=num(r,"ttlSeconds",90);
        Problem.require(ttl>=10&&ttl<=600,"Job lease must be 10..600 seconds");
        Set<String> ids=new TreeSet<>();
        for(String checker:requested)ids.addAll(c.tx().incoming("queue",checker));
        int inspected=0;
        for(String id:ids) {
            if(++inspected>10_000)break;
            Store.Doc d=c.tx().require("job",id);
            Map<String,Object> job=d.body();
            String state=str(job,"state");
            if(!Set.of("QUEUED","RUNNING").contains(state)) {
                c.tx().links("queue",id,Set.of());
                continue;
            }
            Map<String,Object> head=c.tx().require("claimHead",str(job,"claimId")).body();
            if(!currentJob(job,head)) {
                job.put("state","SUPERSEDED");
                c.tx().put("job",id,d.version(),job);
                c.tx().links("queue",id,Set.of());
                continue;
            }
            if(state.equals("RUNNING")&&num(job,"leaseUntil",0)>c.now())continue;
            job.put("state","RUNNING");
            job.put("runner",c.actor().id());
            job.put("fence",num(job,"fence",0)+1);
            job.put("leaseUntil",c.now()+ttl*1000);
            c.tx().put("job",id,d.version(),job);
            c.event("CHECK_LEASED",obj("job",id,"fence",job.get("fence"),"runner",c.actor().id()));
            return obj("job",job,"inspected",inspected);
        }
        return obj("job",null,"inspected",inspected,"searchTruncated",inspected>10_000);
    }
    private static boolean currentJob(Map<String,Object> job,Map<String,Object> head) {
        return num(job,"revision",0)==num(head,"revision",0)&&num(job,"generation",0)==num(head,"generation",0);
    }
    private static void jobLease(Kernel.Ctx c,Map<String,Object> job,Map<String,Object> r) {
        if(!str(job,"runner","").equals(c.actor().id())||num(job,"fence",0)!=num(r,"fence",-1)||num(job,"leaseUntil",0)<=c.now()||!Set.of("RUNNING","SUPERSEDED").contains(str(job,"state")))throw Problem.conflict("Checker lease is expired, stolen, or already completed");
    }
    static Map<String,Object> heartbeat(Kernel.Ctx c,Map<String,Object> r) {
        Store.Doc d=c.tx().require("job",id(r,"jobId"));
        Map<String,Object> job=d.body();
        jobLease(c,job,r);
        long ttl=num(r,"ttlSeconds",90);
        Problem.require(ttl>=10&&ttl<=600,"Job lease must be 10..600 seconds");
        job.put("leaseUntil",c.now()+ttl*1000);
        c.tx().put("job",d.id(),d.version(),job);
        return job;
    }
    static Map<String,Object> finish(Kernel.Ctx c,Map<String,Object> r) {
        String jobId=id(r,"jobId");
        Store.Doc d=c.tx().require("job",jobId);
        Map<String,Object> job=d.body();
        jobLease(c,job,r);
        Map<String,Object> check=child(job,"check");
        if(!c.actor().checkers().contains(str(check,"checker")))throw new Problem(403,"FORBIDDEN","Checker authorization was removed");
        Problem.require(str(r,"checkerVersion").equals(str(check,"version")),"Checker version differs from the required version");
        String outcome=str(r,"result"),coverage=str(r,"coverage");
        Problem.require(Set.of("PASS","FAIL","UNKNOWN").contains(outcome)&&Set.of("COMPLETE","PARTIAL").contains(coverage),"Invalid evidence result or coverage");
        String artifact=str(r,"artifactDigest");
        Problem.require(artifact.matches("[a-f0-9]{64}"),"Evidence must reference a content digest");
        String uri=text(r,"artifactUri",2000);
        Problem.require(uri.startsWith("https://")||uri.startsWith("artifact://")||uri.startsWith("urn:"),"Artifact URI must be HTTPS, artifact:// or urn:");
        List<String> limitations=strings(r,"limitations");
        Problem.require(limitations.size()<=100&&limitations.stream().allMatch(s->s.length()<=2000),"Evidence limitations too large");
        Map<String,Object> head=c.tx().require("claimHead",str(job,"claimId")).body();
        boolean applicable=currentJob(job,head)&&hash(job.get("dependencies")).equals(hash(dependencies(c,claim(c,str(job,"claimId")))));
        if(outcome.equals("PASS")&&!coverage.equals("COMPLETE"))outcome="UNKNOWN";
        String id=c.uuid();
        Map<String,Object> evidence=obj("id",id,"jobId",jobId,"claimId",job.get("claimId"),"revision",job.get("revision"),"generation",job.get("generation"),"check",check,"result",outcome,"coverage",coverage,"runner",c.actor().id(),"at",c.now(),"artifactDigest",artifact,"artifactUri",uri,"dependencies",job.get("dependencies"),"contexts",job.get("contexts"),"limitations",limitations,"applicabilityAtSubmission",applicable?"CURRENT":"HISTORICAL");
        c.tx().put("evidence",id,0,evidence);
        c.tx().links("evidenceFor",id,Set.of(str(job,"claimId")));
        if(applicable) {
            c.tx().upsert("evidenceCurrent",sha(str(job,"claimId")+":"+str(check,"id")),obj("evidenceId",id));
            // A green rerun cannot erase an observed failure on the same obligation generation.
            // Resolving it requires a changed relevant snapshot or an independently reviewed policy/checker revision.
            if(outcome.equals("FAIL"))c.tx().upsert("counterevidence",jobId,obj("evidenceId",id));
        }
        job.put("state",applicable?"COMPLETE":"SUPERSEDED");
        job.put("evidenceId",id);
        job.put("completedAt",c.now());
        c.tx().put("job",jobId,d.version(),job);
        c.tx().links("queue",jobId,Set.of());
        c.event("EVIDENCE_RECORDED",obj("id",id,"claim",job.get("claimId"),"result",outcome,"applicable",applicable));
        return obj("evidence",evidence,"applied",applicable);
    }
    static Map<String,Object> explain(Kernel.Ctx c,String id) {
        Map<String,Object> head=c.tx().require("claimHead",id).body(),claim=claim(c,id);
        List<Object> evidence=new ArrayList<>();
        for(Object o:list(claim,"checks")) {
            Map<String,Object> check=map(o);
            c.tx().get("evidenceCurrent",sha(id+":"+str(check,"id"))).ifPresent(d-> {
                Map<String,Object> e=c.tx().require("evidence",str(d.body(),"evidenceId")).body();
                e.put("currentlyApplicable",num(e,"revision",0)==num(head,"revision",0)&&num(e,"generation",0)==num(head,"generation",0));
                evidence.add(e);
            });
        }
        return obj("claim",claim,"head",head,"assessment",assess(c,id,new HashSet<>(),new HashMap<>()),"evidence",evidence,"arguments",c.tx().incoming("argumentFor",id).stream().map(a->c.tx().require("argument",a).body()).toList(),"debtIds",c.tx().incoming("debtClaim",id));
    }
    static Map<String,Object> assess(Kernel.Ctx c,String id,Set<String> stack,Map<String,Map<String,Object>> memo) {
        if(memo.containsKey(id))return memo.get(id);
        if(!stack.add(id))return obj("status","UNKNOWN","reasons",List.of("Circular argument"),"claimId",id);
        Problem.require(stack.size()<=256,"Argument depth exceeds supported limit");
        Map<String,Object> head=c.tx().require("claimHead",id).body(),claim=claim(c,id);
        List<Object> reasons=new ArrayList<>(),evidenceKinds=new ArrayList<>();
        boolean failed=false;
        for(String component:strings(claim,"components")) {
            Optional<Store.Doc> context=c.tx().get("head",component);
            if(context.isEmpty()) {
                reasons.add(obj("kind","MISSING_COMPONENT","component",component));
                continue;
            }
            Map<String,Object> coverage=child(context.get().body(),"coverage");
            if(!str(coverage,"discovery").equals("COMPLETE"))reasons.add(obj("kind","INCOMPLETE_DISCOVERY","component",component));
            if(!bool(claim,"allowPartialAnalysis",false)&&!str(coverage,"semantic").equals("RESOLVED"))reasons.add(obj("kind","UNRESOLVED_SEMANTICS","component",component));
        }
        for(Object o:list(claim,"checks")) {
            Map<String,Object> check=map(o);
            String checkId=str(check,"id");
            String failureKey=sha(id+":"+num(head,"revision",0)+":"+num(head,"generation",0)+":"+checkId);
            Optional<Store.Doc> knownFailure=c.tx().get("counterevidence",failureKey);
            if(knownFailure.isPresent()) {
                failed=true;
                reasons.add(obj("kind","UNRESOLVED_COUNTEREVIDENCE","check",checkId,"evidence",knownFailure.get().body().get("evidenceId"),"notice","Passing retries cannot retire a failure for the same obligation generation"));
            }
            Optional<Store.Doc> pointer=c.tx().get("evidenceCurrent",sha(id+":"+checkId));
            if(pointer.isEmpty()) {
                reasons.add(obj("kind","MISSING_EVIDENCE","check",checkId));
                continue;
            }
            Map<String,Object> e=c.tx().require("evidence",str(pointer.get().body(),"evidenceId")).body();
            if(num(e,"revision",0)!=num(head,"revision",0)||num(e,"generation",0)!=num(head,"generation",0)||!hash(e.get("dependencies")).equals(hash(dependencies(c,claim)))) {
                reasons.add(obj("kind","STALE_EVIDENCE","check",checkId,"evidence",e.get("id")));
                continue;
            }
            if(str(e,"result").equals("FAIL")) {
                failed=true;
                reasons.add(obj("kind","COUNTEREVIDENCE","check",checkId,"evidence",e.get("id")));
            }
            else if(!str(e,"result").equals("PASS"))reasons.add(obj("kind","INCONCLUSIVE_EVIDENCE","check",checkId));
            else if(c.now()-num(e,"at",0)>num(check,"maxAgeSeconds",86400)*1000)reasons.add(obj("kind","EXPIRED_EVIDENCE","check",checkId));
            else evidenceKinds.add(obj("kind",check.get("kind"),"check",checkId,"evidence",e.get("id"),"limitations",e.get("limitations")));
        }
        String mode=str(claim,"mode");
        String argumentUsed=null;
        List<Object> argumentFailures=new ArrayList<>();
        if(!mode.equals("DIRECT")) {
            for(String aid:c.tx().incoming("argumentFor",id)) {
                Map<String,Object> a=c.tx().require("argument",aid).body();
                if(num(child(a,"conclusion"),"revision",0)!=num(head,"revision",0))continue;
                boolean supported=true;
                List<Object> blockers=new ArrayList<>();
                for(Object p:list(a,"premises")) {
                    Map<String,Object> pin=map(p);
                    String child=str(pin,"id");
                    Map<String,Object> ch=c.tx().require("claimHead",child).body();
                    if(num(ch,"revision",0)!=num(pin,"revision",0)) {
                        supported=false;
                        blockers.add(obj("claim",child,"reason","PREMISE_REVISION_CHANGED"));
                        continue;
                    }
                    Map<String,Object> status=assess(c,child,stack,memo);
                    if(!str(status,"status").equals("SUPPORTED")) {
                        supported=false;
                        blockers.add(obj("claim",child,"assessment",status));
                    }
                }
                if(supported) {
                    argumentUsed=aid;
                    break;
                }
                argumentFailures.add(obj("argument",aid,"blockers",blockers));
            }
            if(argumentUsed==null)reasons.add(obj("kind","NO_SUPPORTED_ARGUMENT","arguments",argumentFailures));
        }
        String status=failed?"VIOLATED":reasons.isEmpty()?"SUPPORTED":"UNKNOWN";
        Map<String,Object> result=obj("claimId",id,"revision",head.get("revision"),"generation",head.get("generation"),"status",status,"reasons",reasons,"evidenceKinds",evidenceKinds,"argumentUsed",argumentUsed,"critical",bool(claim,"critical",true),"assuranceMeaning","Supported by the declared evidence policy, not an unrestricted formal proof");
        stack.remove(id);
        memo.put(id,result);
        return result;
    }
}
