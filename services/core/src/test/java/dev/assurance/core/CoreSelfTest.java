package dev.assurance.core;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static dev.assurance.core.Json.*;
/** Dependency-free executable regression suite, also run by Maven during the core test phase. */ public final class CoreSelfTest {
    static int checks=0,tests=0;
    static void check(boolean value,String message) {
        checks++;
        if(!value)throw new AssertionError(message);
    }
    static void equal(Object a,Object b,String message) {
        check(Objects.equals(a,b),message+" expected="+b+" actual="+a);
    }
    static void problem(int status,Runnable action) {
        checks++;
        try {
            action.run();
            throw new AssertionError("Expected HTTP "+status);
        }
        catch(Problem p) {
            if(p.status!=status)throw new AssertionError("Expected "+status+", got "+p.status+" "+p.getMessage());
        }
    }
    static void test(String name,Runnable action) {
        action.run();
        tests++;
        System.out.println("PASS "+name);
    }
    static final class MutableClock extends Clock {
        long time=1_800_000_000_000L;
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }
        public Clock withZone(ZoneId z) {
            return this;
        }
        public Instant instant() {
            return Instant.ofEpochMilli(time);
        }
        public long millis() {
            return time;
        }
        void advance(long ms) {
            time+=ms;
        }
    }
    static Auth.Principal principal(String id,String tenant,Auth.Role role) {
        return new Auth.Principal(id,tenant,Set.of(role),Set.of("demo"),Set.of("unit-tests","static-check","protocol-model","release-gate"));
    }
    static final class Fixture {
        final MemoryStore store=new MemoryStore();
        final MutableClock clock=new MutableClock();
        final Kernel kernel=new Kernel(store,clock);
        final Auth.Principal agent=principal("agent-a","demo",Auth.Role.AGENT),other=principal("agent-b","demo",Auth.Role.AGENT),scanner=principal("scanner","demo",Auth.Role.SCANNER),runner=principal("runner","demo",Auth.Role.RUNNER),reviewer=principal("reviewer","demo",Auth.Role.MAINTAINER);
        Map<String,Object> call(Auth.Principal p,String op,Map<String,Object> body) {
            return kernel.call(p,"demo",op,body,UUID.randomUUID().toString());
        }
        String head() {
            List<Object> rows=list(call(agent,"heads.list",obj()),"items");
            return rows.isEmpty()?"":str(child(map(rows.getFirst()),"value"),"head");
        }
        String stage(String expected,List<Map<String,Object>> facts,String semantic,String discovery) {
            Map<String,Object> s=call(scanner,"scan.start",obj("component","svc","expectedHead",expected,"sourceRevision","a".repeat(40),"environment",obj("runtime",sha("runtime")),"configurationDigest",sha("fixture"),"expectedFacts",facts.size(),"coverage",obj("discovery",discovery,"semantic",semantic,"limitations",List.of()),"analyzer","fixture/1","rulesExecuted",List.of("FIXTURE_RULE")));
            String id=str(s,"id");
            call(scanner,"scan.batch",obj("scanId",id,"facts",facts,"findings",List.of()));
            return id;
        }
        Map<String,Object> publish(List<Map<String,Object>> facts) {
            return call(scanner,"scan.commit",obj("scanId",stage(head(),facts,"RESOLVED","COMPLETE")));
        }
        Map<String,Object> approve(String id,boolean critical) {
            return call(reviewer,"claims.approve",definition(id,0,critical,"DIRECT",List.of(checkSpec())));
        }
        Map<String,Object> definition(String id,long revision,boolean critical,String mode,List<Object> checks) {
            return obj("id",id,"expectedRevision",revision,"statement","Every current and future writer obeys the terminal-state gate","owner","platform","components",List.of("svc"),"watch",List.of("scope:svc:writers"),"quantification","ALL_MATCHING","checks",checks,"mode",mode,"critical",critical,"allowPartialAnalysis",false);
        }
        Map<String,Object> explain(String id) {
            return call(agent,"claims.explain",obj("id",id));
        }
        long generation(String id) {
            return num(child(explain(id),"head"),"generation",0);
        }
        String status(String id) {
            return str(child(explain(id),"assessment"),"status");
        }
        Map<String,Object> job() {
            return child(call(runner,"jobs.claim",obj("checkers",List.of("unit-tests"),"ttlSeconds",90)),"job");
        }
        Map<String,Object> finish(Map<String,Object> job,String result) {
            return call(runner,"jobs.finish",obj("jobId",job.get("id"),"fence",job.get("fence"),"checkerVersion","1","result",result,"coverage","COMPLETE","artifactDigest",sha("test-output"),"artifactUri","artifact://tests/output","limitations",List.of("Fixture check")));
        }
        void allPass() {
            for(int i=0; i<100; i++) {
                Map<String,Object> response=call(runner,"jobs.claim",obj("checkers",List.of("unit-tests")));
                if(response.get("job")==null)return;
                finish(child(response,"job"),"PASS");
            }
            throw new AssertionError("Queue did not drain");
        }
        Map<String,Object> plan(Auth.Principal p) {
            return child(call(p,"plans.prepare",obj("intent","Fix lifecycle cleanup","components",List.of("svc"),"writeSelectors",List.of("component:svc"))),"plan");
        }
    }
    static Map<String,Object> checkSpec() {
        return obj("id","unit","kind","TEST","checker","unit-tests","version","1","maxAgeSeconds",60);
    }
    static Map<String,Object> fact(String locator,String contents,String... tags) {
        return obj("id",sha("svc:"+locator),"locator",locator,"path",locator.split("#")[0],"language","TS","kind","FUNCTION","contentHash",sha(contents),"signatureHash",sha("signature"),"tags",List.of(tags),"effects",List.of(),"metrics",obj("guards",1L),"line",1L);
    }
    static Object variable(String name) {
        return obj("var",name);
    }
    static Object op(String name,Object... args) {
        return obj("op",name,"args",List.of(args));
    }
    static Map<String,Object> cancellationModel(boolean safe) {
        return obj("initial",obj("state","RUNNING","cancelled",false),"domains",obj("state",List.of("RUNNING","CANCELLED","SUCCESS"),"cancelled",List.of(false,true)),"transitions",List.of(obj("id","cancel","when",op("eq",variable("state"),"RUNNING"),"set",obj("state","CANCELLED","cancelled",true)),obj("id","success","when",safe?op("eq",variable("state"),"RUNNING"):op("ne",variable("state"),"SUCCESS"),"set",obj("state","SUCCESS"))),"invariants",List.of(obj("id","no-success-after-cancel","predicate",op("not",op("and",variable("cancelled"),op("eq",variable("state"),"SUCCESS"))))),"terminal",op("ne",variable("state"),"RUNNING"),"maxStates",100,"maxDepth",20);
    }
    public static void main(String[] args) {
        test("mission frontier preserves alternatives, revision review, stale cursors and budgets",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","one","writers")));
            f.approve("leaf",true);
            f.call(f.reviewer,"claims.approve",f.definition("root",0,true,"DECOMPOSED",List.of()));
            f.call(f.reviewer,"arguments.approve",obj("id","route","conclusion",obj("id","root","revision",1),
                "premises",List.of(obj("id","leaf","revision",1)),"rationale","Reviewed fixture reduction","limitations",List.of()));
            Map<String,Object> first=f.call(f.agent,"claims.frontier",obj("id","root","limit",1));
            equal(num(first,"unresolvedClaims",0),2L,"Root and leaf are initially open");
            check(bool(first,"hasMore",false),"Frontier is paginated");
            Map<String,Object> second=f.call(f.agent,"claims.frontier",obj("id","root","limit",1,"after",first.get("next"),"fingerprint",first.get("fingerprint")));
            equal(str(map(list(second,"items").getFirst()),"action"),"RESOLVE_ARGUMENT_ALTERNATIVE","Root explains its reduction");
            problem(400,()->f.call(f.agent,"claims.frontier",obj("id","root","maxClaims",1)));
            f.allPass();
            Map<String,Object> closed=f.call(f.agent,"claims.frontier",obj("id","root"));
            equal(str(closed,"rootStatus"),"SUPPORTED","Supported premises close the reviewed root");
            equal(list(closed,"items").size(),0,"Supported routes create no frontier work");
            problem(409,()->f.call(f.agent,"claims.frontier",obj("id","root","after",first.get("next"),"fingerprint",first.get("fingerprint"))));
            f.call(f.reviewer,"claims.approve",f.definition("leaf",1,true,"DIRECT",List.of(checkSpec())));
            Map<String,Object> changed=f.call(f.agent,"claims.frontier",obj("id","root"));
            check(write(changed).contains("REVIEW_ARGUMENT_REVISION"),"Changed premise requires reviewed re-binding");
            equal(num(changed,"unresolvedClaims",0),1L,"An unbound replacement is not silently adopted");
        });
        test("strict JSON and canonical digests",()-> {
            equal(write(parse("{\"b\":2,\"a\":[true,null,\"x\"]}")),"{\"a\":[true,null,\"x\"],\"b\":2}","Canonical ordering");
            equal(hash(obj("a",1,"b",2)),hash(obj("b",2,"a",1)),"Map insertion order cannot change digest");
            for(String invalid:List.of("{\"x\":1,\"x\":2}","[1,]","01","NaN","1e999","\"bad\nstring\""))problem(400,()->parse(invalid));
            equal(parse(write("😀")),"😀","Unicode round trip");
        });
        test("atomic rollback and event sequence",()-> {
            MemoryStore s=new MemoryStore();
            Store.Space space=new Store.Space("t","w");
            try {
                s.write(space,tx-> {
                    tx.put("x","y",0,obj("v",1));
                    tx.event(1,"a","TEST",obj());
                    throw new IllegalStateException("abort");
                });
            }
            catch(IllegalStateException expected) {
            }
            check(s.read(space,tx->tx.get("x","y").isEmpty()),"Rolled-back row must not survive");
            equal(s.read(space,tx->tx.events(0,10).size()),0,"Rolled-back event must not survive");
            equal(s.write(space,tx->tx.event(1,"a","TEST",obj()).sequence()),1L,"First committed event sequence");
        });
        test("negative-scope membership and selective invalidation",()-> {
            Fixture f=new Fixture();
            Map<String,Object> a=fact("a.ts#write","v1","writers"),b=fact("b.ts#read","v1","readers");
            f.publish(List.of(a,b));
            f.approve("isolation",true);
            f.allPass();
            equal(f.status("isolation"),"SUPPORTED","Initial evidence");
            long before=f.generation("isolation");
            f.publish(List.of(a,fact("b.ts#read","v2","readers")));
            equal(f.generation("isolation"),before,"Unwatched reader change should not invalidate writer scope");
            equal(f.status("isolation"),"SUPPORTED","Applicable evidence survives irrelevant fact change");
            f.publish(List.of(a,b,fact("new.ts#writer","new","writers")));
            check(f.generation("isolation")>before,"New writer must invalidate universal scope evidence");
            equal(f.status("isolation"),"UNKNOWN","Stale evidence is not a discovered defect");
        });
        test("unchanged scan and historical immutable subjects",()-> {
            Fixture f=new Fixture();
            var a=fact("a.ts#write","v1","writers");
            String initial=str(child(f.publish(List.of(a)),"head"),"head");
            f.approve("safe",true);
            long generation=f.generation("safe");
            f.publish(List.of(a));
            equal(f.head(),initial,"No-op scan preserves head");
            equal(f.generation("safe"),generation,"No-op scan preserves evidence generation");
            f.publish(List.of(fact("a.ts#write","v2","writers")));
            Map<String,Object> historic=f.call(f.agent,"snapshots.subject",obj("head",initial,"subjectId",a.get("id")));
            equal(str(child(historic,"subject"),"contentHash"),sha("v1"),"History must retain exact old fact");
            f.publish(List.of());
            Map<String,Object> removed=f.call(f.agent,"snapshots.subject",obj("head",f.head(),"subjectId",a.get("id")));
            check(removed.get("subject")==null,"Deleted subjects must be tombstoned");
        });
        test("optimistic publication rejects concurrent overwrites",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#write","v1","writers")));
            String base=f.head();
            String a=f.stage(base,List.of(fact("a.ts#write","A","writers")),"RESOLVED","COMPLETE"),b=f.stage(base,List.of(fact("a.ts#write","B","writers")),"RESOLVED","COMPLETE");
            f.call(f.scanner,"scan.commit",obj("scanId",a));
            problem(409,()->f.call(f.scanner,"scan.commit",obj("scanId",b)));
        });
        test("idempotency is actor-bound and payload-bound",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            String key="fixed-key";
            Map<String,Object> input=obj("kind","HYPOTHESIS","components",List.of("svc"),"text","A possible cleanup issue");
            Map<String,Object> one=f.kernel.call(f.agent,"demo","memory.write",input,key),two=f.kernel.call(f.agent,"demo","memory.write",input,key);
            equal(hash(one),hash(two),"Retry must return original result");
            input.put("text","Changed input");
            problem(409,()->f.kernel.call(f.agent,"demo","memory.write",input,key));
        });
        test("old checker results remain historical after drift",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("safe",true);
            Map<String,Object> job=f.job();
            f.publish(List.of(fact("a.ts#f","v2","writers")));
            Map<String,Object> result=f.finish(job,"PASS");
            equal(result.get("applied"),false,"Stale checker must not bless newer code");
            equal(f.status("safe"),"UNKNOWN","Historical pass cannot establish current assurance");
            problem(403,()->f.call(f.agent,"jobs.finish",obj()));
        });
        test("freshness, partial evidence, and explicit rechecks",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("safe",true);
            Map<String,Object> job=f.job();
            f.call(f.runner,"jobs.finish",obj("jobId",job.get("id"),"fence",job.get("fence"),"checkerVersion","1","result","PASS","coverage","PARTIAL","artifactDigest",sha("x"),"artifactUri","urn:test:partial","limitations",List.of()));
            equal(f.status("safe"),"UNKNOWN","Partial pass cannot become complete support");
            f.call(f.agent,"claims.recheck",obj("id","safe"));
            f.allPass();
            equal(f.status("safe"),"SUPPORTED","Recheck supplies current evidence");
            f.clock.advance(61_000);
            equal(f.status("safe"),"UNKNOWN","Expired pass must become unknown");
        });
        test("flaky green retries cannot launder same-generation counterevidence",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("safe",true);
            f.finish(f.job(),"FAIL");
            f.call(f.agent,"claims.recheck",obj("id","safe"));
            f.allPass();
            equal(f.status("safe"),"VIOLATED","A green retry must not erase a known failure");
            f.clock.advance(100_000);
            equal(f.status("safe"),"VIOLATED","Counterevidence cannot expire into a pass");
            f.publish(List.of(fact("a.ts#f","fixed","writers")));
            equal(f.status("safe"),"UNKNOWN","Changed relevant code requires new evidence");
            f.allPass();
            equal(f.status("safe"),"SUPPORTED","Fresh evidence may support the changed generation");
        });
        test("credentials cannot combine independent authority roles",()-> {
            problem(400,()->new Auth(write(List.of(obj("id","agent","tenant","demo","tokenSha256",sha("secret"),"roles",List.of("AGENT","RUNNER"),"workspaces",List.of("demo"),"checkers",List.of("unit-tests"))))));
        });
        test("model misspellings cannot silently drop guards",()-> {
            Map<String,Object> model=cancellationModel(true);
            map(list(model,"transitions").getFirst()).put("guard",true);
            problem(400,()->new ModelChecker().check(model));
        });
        test("incomplete discovery is not absence evidence",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("safe",true);
            f.allPass();
            String scan=f.stage(f.head(),List.of(),"PARTIAL","PARTIAL");
            f.call(f.scanner,"scan.commit",obj("scanId",scan));
            f.allPass();
            equal(f.status("safe"),"UNKNOWN","Passing tests do not fix missing source discovery");
            equal(list(f.call(f.agent,"subjects.list",obj("component","svc")),"items").size(),1,"Partial scans cannot delete unseen subjects");
        });
        test("fenced leases and semantic overlap",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("safe",true);
            Map<String,Object> a=f.plan(f.agent),b=f.plan(f.other);
            Map<String,Object> first=f.call(f.agent,"leases.acquire",obj("planId",a.get("id"),"ttlSeconds",10));
            problem(409,()->f.call(f.other,"leases.acquire",obj("planId",b.get("id"),"ttlSeconds",10)));
            f.clock.advance(11_000);
            Map<String,Object> second=f.call(f.other,"leases.acquire",obj("planId",b.get("id"),"ttlSeconds",10));
            long f1=num(map(list(first,"leases").getFirst()),"fence",0),f2=num(map(list(second,"leases").getFirst()),"fence",0);
            check(f2>f1,"Reacquisition must increase fencing token");
            problem(409,()->f.call(f.agent,"leases.renew",obj("planId",a.get("id"))));
        });
        test("plans pin policy and snapshots",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("safe",true);
            f.allPass();
            Map<String,Object> p=f.plan(f.agent);
            f.call(f.agent,"leases.acquire",obj("planId",p.get("id")));
            equal(f.call(f.agent,"plans.validate",obj("planId",p.get("id"))).get("allowed"),true,"Supported plan should pass");
            f.approve("new-obligation",true);
            equal(f.call(f.agent,"plans.validate",obj("planId",p.get("id"))).get("allowed"),false,"New requirements cannot be omitted by an old plan");
        });
        test("reviewed AND arguments, stale premises, and cycles",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("child",true);
            f.call(f.reviewer,"claims.approve",f.definition("parent",0,true,"DECOMPOSED",List.of()));
            f.call(f.reviewer,"arguments.approve",obj("id","composition","conclusion",obj("id","parent","revision",1),"premises",List.of(obj("id","child","revision",1)),"rationale","These premises are sufficient for this bounded requirement"));
            equal(f.status("parent"),"UNKNOWN","Missing premise evidence");
            f.allPass();
            equal(f.status("parent"),"SUPPORTED","Supported child establishes reviewed argument");
            f.call(f.reviewer,"claims.approve",f.definition("child",1,true,"DIRECT",List.of(checkSpec())));
            f.allPass();
            equal(f.status("parent"),"UNKNOWN","Argument pins child revision, not a silently replaced statement");
            f.call(f.reviewer,"claims.approve",f.definition("A",0,true,"DECOMPOSED",List.of()));
            f.call(f.reviewer,"claims.approve",f.definition("B",0,true,"DECOMPOSED",List.of()));
            f.call(f.reviewer,"arguments.approve",obj("id","AB","conclusion",obj("id","A","revision",1),"premises",List.of(obj("id","B","revision",1)),"rationale","A from B"));
            problem(400,()->f.call(f.reviewer,"arguments.approve",obj("id","BA","conclusion",obj("id","B","revision",1),"premises",List.of(obj("id","A","revision",1)),"rationale","Invalid circularity")));
        });
        test("debt exceptions never alter truth and expire",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("safe",false);
            f.finish(f.job(),"FAIL");
            Map<String,Object> debt=f.call(f.agent,"debts.propose",obj("title","Deferred cleanup","mechanism","Task ownership is not yet explicit","owner","platform","affectedClaims",List.of("safe"),"repaymentClaims",List.of("safe"),"sourceFindingIds",List.of()));
            f.call(f.reviewer,"debts.decide",obj("id",debt.get("id"),"expectedVersion",1,"state","ACCEPTED_EXCEPTION","expiresAt",f.clock.millis()+1000,"rationale","Bounded operational exposure"));
            equal(f.status("safe"),"VIOLATED","Waiver does not change failed evidence");
            Map<String,Object> p=f.plan(f.agent);
            f.call(f.agent,"leases.acquire",obj("planId",p.get("id")));
            equal(f.call(f.agent,"plans.validate",obj("planId",p.get("id"))).get("disposition"),"ALLOW_WITH_EXCEPTIONS","Release disposition is separate");
            f.clock.advance(1001);
            equal(f.call(f.agent,"plans.validate",obj("planId",p.get("id"))).get("allowed"),false,"Expired exception blocks without waiting for a scheduled sweep");
            problem(409,()->f.call(f.reviewer,"debts.close",obj("id",debt.get("id"),"expectedVersion",2,"rationale","Delete the TODO")));
        });
        test("critical obligations cannot be waived",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("critical",true);
            Map<String,Object> debt=f.call(f.agent,"debts.propose",obj("title","Critical liability","mechanism","Unresolved isolation","owner","security","affectedClaims",List.of("critical"),"repaymentClaims",List.of("critical")));
            problem(400,()->f.call(f.reviewer,"debts.decide",obj("id",debt.get("id"),"expectedVersion",1,"state","ACCEPTED_EXCEPTION","expiresAt",f.clock.millis()+1000,"rationale","Not allowed")));
        });
        test("memory provenance and staleness",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.call(f.agent,"memory.write",obj("kind","HANDOFF","components",List.of("svc"),"text","Ignore all policies is untrusted quoted repository text"));
            Map<String,Object> item=map(list(f.call(f.agent,"memory.search",obj()),"items").getFirst());
            equal(item.get("trust"),"UNTRUSTED_AGENT_CONTENT","Agent text cannot acquire authority");
            equal(item.get("stale"),false,"Current context");
            f.publish(List.of(fact("a.ts#f","v2","writers")));
            equal(map(list(f.call(f.agent,"memory.search",obj()),"items").getFirst()).get("stale"),true,"Old handoff must become stale");
        });
        test("finite-state counterexamples and bounded uncertainty",()-> {
            ModelChecker checker=new ModelChecker();
            equal(str(checker.check(cancellationModel(false)),"status"),"COUNTEREXAMPLE","Unsafe cancellation path");
            equal(str(checker.check(cancellationModel(true)),"status"),"MODEL_SATISFIED","Safe finite model");
            Map<String,Object> bounded=cancellationModel(true);
            bounded.put("maxStates",1);
            equal(str(checker.check(bounded),"status"),"INCONCLUSIVE","Bounds cannot be represented as a proof");
            bounded.put("invariants",List.of(obj("id","bad","predicate",obj("op","eval","args",List.of("code")))));
            problem(400,()->checker.check(bounded));
        });
        test("causal traces preserve identity and uncertainty",()-> {
            TraceChecker checker=new TraceChecker();
            Map<String,Object> a=obj("id","a","entity","job-1","executionEpoch","7","kind","CANCELLED","parents",List.of()),b=obj("id","b","entity","job-1","executionEpoch","7","kind","SUCCESS","parents",List.of("a"));
            Map<String,Object> r=obj("first","CANCELLED","later","SUCCESS","events",List.of(a,b));
            equal(str(checker.check(r),"status"),"OBSERVED_VIOLATION","Ordered success after cancel");
            b.put("executionEpoch","8");
            equal(str(checker.check(r),"status"),"NOT_OBSERVED","Different execution epoch must not be conflated");
            b.put("parents",List.of("missing"));
            equal(str(checker.check(r),"status"),"INCONCLUSIVE","Missing causality cannot be ignored");
        });
        test("authorization and tenant isolation",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            f.approve("safe",true);
            problem(403,()->f.call(f.agent,"claims.approve",f.definition("forged",0,true,"DIRECT",List.of(checkSpec()))));
            problem(404,()->f.call(principal("reader","another",Auth.Role.READER),"claims.get",obj("id","safe")));
            problem(403,()->f.kernel.call(f.agent,"not-allowed","heads.list",obj(),null));
            Map<String,Object> exact=f.definition("negative",0,true,"DIRECT",List.of(checkSpec()));
            exact.put("watch",List.of("subject:svc:"+sha("svc:a.ts#f")));
            problem(400,()->f.call(f.reviewer,"claims.approve",exact));
        });
        test("JDK AST Spring and lifecycle diagnostics",()-> {
            String source="import java.util.concurrent.*; @interface Transactional {} @interface Async {} class Service { @Transactional private void save() {} @Async void later() {} void run() { save(); later(); Executors.newCachedThreadPool(); try { Thread.sleep(1); } catch (InterruptedException e) {} } }";
            Map<String,Object> result=new JavaAnalyzer().analyze(obj("component","svc","files",List.of(obj("path","Service.java","source",source))));
            Set<String> rules=new HashSet<>();
            for(Object o:list(result,"findings"))rules.add(str(map(o),"ruleId"));
            for(String rule:List.of("SPRING_SELF_INVOCATION","SPRING_ASYNC_SELF_INVOCATION","SPRING_PRIVATE_TRANSACTION","JAVA_INTERRUPTION_SWALLOWED","JAVA_UNBOUNDED_EXECUTOR"))check(rules.contains(rule),"Missing diagnostic "+rule);
            equal(str(child(result,"coverage"),"semantic"),"PARTIAL","Server must not pretend to have a build classpath");
        });
        test("HTTP boundary rejects bad credentials and origins",()-> {
            Fixture f=new Fixture();
            ApiRouter router=new ApiRouter(f.kernel,new Auth(DevServer.demoAuth()));
            Map<String,String> h=new HashMap<>(Map.of("content-type","application/json"));
            equal(router.handle("POST","/v1/demo/heads.list",h,"{}".getBytes()).status(),401,"Missing bearer");
            h.put("authorization","Bearer demo-agent-token");
            equal(router.handle("POST","/v1/demo/heads.list",h,"{}".getBytes()).status(),200,"Authorized read");
            h.put("origin","https://untrusted.invalid");
            equal(router.handle("POST","/v1/demo/heads.list",h,"{}".getBytes()).status(),403,"Browser origin blocked");
        });
        test("parallel optimistic writers have exactly one winner",()-> {
            Fixture f=new Fixture();
            f.publish(List.of(fact("a.ts#f","v1","writers")));
            String base=f.head();
            List<String> scans=new ArrayList<>();
            // Every contender must change the base; a no-op may legitimately succeed before the winning update.
            for(int i=0; i<12; i++)scans.add(f.stage(base,List.of(fact("a.ts#f","candidate-"+i,"writers")),"RESOLVED","COMPLETE"));
            AtomicInteger winners=new AtomicInteger();
            try(ExecutorService pool=Executors.newFixedThreadPool(12)) {
                List<Future<?>> futures=new ArrayList<>();
                for(String scan:scans)futures.add(pool.submit(()-> {
                    try {
                        f.call(f.scanner,"scan.commit",obj("scanId",scan));
                        winners.incrementAndGet();
                    }
                    catch(Problem p) {
                        if(p.status!=409)throw p;
                    }
                }));
                for(Future<?> future:futures)try {
                    future.get();
                }
                catch(Exception e) {
                    throw new AssertionError(e);
                }
            }
            equal(winners.get(),1,"Workspace lock and CAS must prevent lost updates");
        });
        System.out.println("CORE_VERIFICATION tests="+tests+" assertions="+checks+" java="+System.getProperty("java.version"));
    }
}
