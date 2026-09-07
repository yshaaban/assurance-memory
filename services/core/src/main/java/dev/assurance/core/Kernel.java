package dev.assurance.core;
import java.time.Clock;
import java.util.*;
import static dev.assurance.core.Json.*;
import static dev.assurance.core.Auth.Role.*;
/** Application boundary. Every mutating operation is authorized, idempotent and atomic with its audit events. */ public final class Kernel {
    public record Ctx(Store.Tx tx,Auth.Principal actor,long now) {
        public void event(String type,Map<String,Object> data) {
            tx.event(now,actor.id(),type,data);
        }
        public String uuid() {
            return UUID.randomUUID().toString();
        }
    }
    private final Store store;
    private final Clock clock;
    public Kernel(Store store,Clock clock) {
        this.store=store;
        this.clock=clock;
    }
    public Store store() {
        return store;
    }
    private static final Set<String> READS=Set.of("evidence.get","evidence.list","claims.get","claims.list","claims.explain","claims.frontier","plans.get","plans.validate","debts.list","memory.search","findings.list","subjects.list","events.list","heads.list","jobs.list","gate.get","graph.neighbors","proposals.list","snapshots.subject","churn.list");
    public Map<String,Object> call(Auth.Principal actor,String workspace,String operation,Map<String,Object> request,String idempotencyKey) {
        Problem.require(workspace.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,79}"),"Invalid workspace");
        actor.workspace(workspace);
        authorize(actor,operation);
        Store.Space space=new Store.Space(actor.tenant(),workspace);
        if(operation.equals("models.check"))return new ModelChecker().check(request);
        if(operation.equals("traces.check"))return new TraceChecker().check(request);
        if(operation.equals("analysis.java"))return new JavaAnalyzer().analyze(request);
        if(READS.contains(operation))return store.read(space,tx->dispatch(new Ctx(tx,actor,clock.millis()),operation,request));
        Problem.require(idempotencyKey!=null&&idempotencyKey.matches("[A-Za-z0-9_.:-]{1,128}"),"A valid Idempotency-Key header is required");
        String receipt=sha(actor.id()+":"+idempotencyKey),requestHash=hash(obj("operation",operation,"body",request));
        return store.write(space,tx-> {
            Optional<Store.Doc> prior=tx.get("receipt",receipt);
            if(prior.isPresent()) {
                if(!str(prior.get().body(),"requestHash").equals(requestHash))throw Problem.conflict("Idempotency key was reused with different input");
                return child(prior.get().body(),"response");
            }
            Ctx ctx=new Ctx(tx,actor,clock.millis());
            Map<String,Object> response=dispatch(ctx,operation,request);
            tx.put("receipt",receipt,0,obj("requestHash",requestHash,"operation",operation,"actor",actor.id(),"at",ctx.now,"response",response));
            return response;
        });
    }
    private void authorize(Auth.Principal actor,String operation) {
        if(READS.contains(operation)) {
            actor.allow(READER,AGENT,SCANNER,RUNNER,MAINTAINER);
            return;
        }
        switch(operation) {
            case "scan.start","scan.batch","scan.commit","analysis.java" -> actor.allow(SCANNER);
            case "claims.approve","arguments.approve","debts.decide","debts.close","maintenance.run" -> actor.allow(MAINTAINER);
            case "jobs.claim","jobs.heartbeat","jobs.finish","gate.issue" -> actor.allow(RUNNER);
            case "claims.recheck","claims.propose","plans.prepare","leases.acquire","leases.renew","leases.release","memory.write","debts.propose" -> actor.allow(AGENT,MAINTAINER);
            case "models.check","traces.check" -> actor.allow(READER,AGENT,RUNNER,MAINTAINER);
            default -> throw Problem.missing("Unknown operation");
        }
    }
    private Map<String,Object> dispatch(Ctx c,String op,Map<String,Object> r) {
        return switch(op) {
            case "scan.start"->Scans.start(c,r);
            case "scan.batch"->Scans.batch(c,r);
            case "scan.commit"->Scans.commit(c,r);
            case "evidence.get"->c.tx.require("evidence",id(r,"id")).body();
            case "evidence.list"->page(c,"evidence",r);
            case "claims.recheck"->Claims.recheck(c,r);
            case "claims.propose"->Claims.propose(c,r);
            case "claims.approve"->Claims.approve(c,r);
            case "arguments.approve"->Claims.argument(c,r);
            case "claims.get","claims.explain"->Claims.explain(c,id(r,"id"));
            case "claims.frontier"->Frontier.read(c,r);
            case "claims.list"->page(c,"claimHead",r);
            case "jobs.claim"->Claims.claimJob(c,r);
            case "jobs.heartbeat"->Claims.heartbeat(c,r);
            case "jobs.finish"->Claims.finish(c,r);
            case "jobs.list"->page(c,"job",r);
            case "plans.prepare"->Coordination.prepare(c,r);
            case "plans.get"->c.tx.require("plan",id(r,"id")).body();
            case "plans.validate"->Coordination.validate(c,r);
            case "leases.acquire"->Coordination.acquire(c,r);
            case "leases.renew"->Coordination.renew(c,r);
            case "leases.release"->Coordination.release(c,r);
            case "gate.issue"->Coordination.gate(c,r);
            case "gate.get"->Coordination.getGate(c,r);
            case "debts.propose"->MemoryDebt.propose(c,r);
            case "debts.decide"->MemoryDebt.decide(c,r);
            case "debts.close"->MemoryDebt.close(c,r);
            case "debts.list"->MemoryDebt.listDebt(c,r);
            case "memory.write"->MemoryDebt.writeMemory(c,r);
            case "memory.search"->MemoryDebt.search(c,r);
            case "snapshots.subject"->Scans.historicalSubject(c,r);
            case "churn.list"->page(c,"churn."+id(r,"component"),r);
            case "findings.list"->page(c,"finding",r);
            case "subjects.list"->page(c,"fact."+id(r,"component"),r);
            case "heads.list"->page(c,"head",r);
            case "proposals.list"->page(c,"proposal",r);
            case "events.list"-> {
                int limit=limit(r);
                List<Store.Event> events=c.tx.events(num(r,"after",0),limit+1);
                boolean more=events.size()>limit;
                List<Store.Event> visible=events.stream().limit(limit).toList();
                yield obj("items",visible.stream().map(e->obj("sequence",e.sequence(),"at",e.at(),"actor",e.actor(),"type",e.type(),"body",e.body())).toList(),"hasMore",more,"next",visible.isEmpty()?num(r,"after",0):visible.getLast().sequence());
            }
            case "graph.neighbors"-> {
                String relation=str(r,"relation");
                Problem.require(Set.of("watch","parent","componentClaim","debtClaim","queue").contains(relation),"Unknown graph relation");
                yield obj("incoming",c.tx.incoming(relation,str(r,"target","")),"outgoing",c.tx.outgoing(relation,str(r,"source","")));
            }
            case "maintenance.run"->maintenance(c);
            default->throw Problem.missing("Unknown operation");
        };
    }
    static int limit(Map<String,Object> r) {
        long n=num(r,"limit",100);
        Problem.require(n>=1&&n<=500,"limit must be 1..500");
        return (int)n;
    }
    static Map<String,Object> page(Ctx c,String kind,Map<String,Object> r) {
        int n=limit(r);
        String after=r.get("after") instanceof String s?s:"";
        List<Store.Doc> rows=c.tx.page(kind,after,n+1);
        boolean more=rows.size()>n;
        List<Store.Doc> visible=rows.stream().limit(n).toList();
        return obj("items",visible.stream().map(d->obj("id",d.id(),"version",d.version(),"value",d.body())).toList(),"hasMore",more,"next",visible.isEmpty()?after:visible.getLast().id());
    }
    public static Map<String,Object> maintenance(Ctx c) {
        int expired=MemoryDebt.expire(c);
        int scans=Scans.expire(c);
        return obj("expiredDebtDecisions",expired,"expiredScans",scans);
    }
}
