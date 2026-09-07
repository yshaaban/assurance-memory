package dev.assurance.core;
import java.util.*;
import static dev.assurance.core.Json.*;
/** Agent-authored memory is descriptive, never authoritative. Debt disposition never changes claim truth. */ final class MemoryDebt {
    private MemoryDebt() {
    }
    static Map<String,Object> writeMemory(Kernel.Ctx c,Map<String,Object> r) {
        String kind=str(r,"kind");
        Problem.require(Set.of("HYPOTHESIS","HANDOFF","INCIDENT","PROCEDURE","DECISION_PROPOSAL").contains(kind),"Invalid memory kind");
        List<String> components=strings(r,"components");
        Problem.require(!components.isEmpty()&&components.size()<=100,"Memory needs 1..100 components");
        Map<String,Object> heads=new TreeMap<>();
        for(String component:components)heads.put(component,c.tx().require("head",component).body().get("head"));
        long ttl=num(r,"ttlSeconds",604800);
        Problem.require(ttl>=60&&ttl<=31_536_000,"Memory TTL must be 60..31536000 seconds");
        Map<String,Object> note=obj("id",c.uuid(),"kind",kind,"text",text(r,"text",32_000),"components",components,"basedOn",heads,"author",c.actor().id(),"at",c.now(),"expiresAt",c.now()+ttl*1000,"provenance",list(r,"provenance"),"trust","UNTRUSTED_AGENT_CONTENT","authority","DESCRIPTIVE_ONLY");
        if(r.containsKey("supersedes")) {
            String old=id(r,"supersedes");
            c.tx().require("memory",old);
            note.put("supersedes",old);
        }
        c.tx().put("memory",str(note,"id"),0,note);
        c.tx().links("memoryComponent",str(note,"id"),new HashSet<>(components));
        c.event("MEMORY_RECORDED",obj("id",note.get("id"),"kind",kind));
        return note;
    }
    static Map<String,Object> search(Kernel.Ctx c,Map<String,Object> r) {
        String query=str(r,"query","").toLowerCase(Locale.ROOT),component=str(r,"component","");
        Problem.require(query.length()<=500,"Query too long");
        String after=str(r,"after","");
        int limit=Kernel.limit(r);
        // Deterministic exact/substring search, with a bounded inspection window and explicit continuation.
        List<Store.Doc> candidates=c.tx().page("memory",after,Math.min(1000,limit*4+1));
        List<Object> hits=new ArrayList<>();
        String cursor=after;
        int inspected=0;
        for(Store.Doc d:candidates) {
            cursor=d.id();
            inspected++;
            Map<String,Object> note=d.body();
            if(!component.isEmpty()&&!strings(note,"components").contains(component))continue;
            if(!str(note,"text").toLowerCase(Locale.ROOT).contains(query))continue;
            boolean stale=num(note,"expiresAt",0)<=c.now();
            for(var pin:child(note,"basedOn").entrySet()) {
                String current=c.tx().get("head",pin.getKey()).map(x->str(x.body(),"head")).orElse("");
                if(!Objects.equals(pin.getValue(),current))stale=true;
            }
            note.put("stale",stale);
            hits.add(note);
            if(hits.size()==limit)break;
        }
        return obj("items",hits,"next",cursor,"hasMore",inspected<candidates.size()||candidates.size()==Math.min(1000,limit*4+1),"inspected",inspected,"ranking","Deterministic substring search; no embedding-based authority inference");
    }
    static Map<String,Object> propose(Kernel.Ctx c,Map<String,Object> r) {
        List<String> claims=strings(r,"affectedClaims").stream().distinct().sorted().toList();
        Problem.require(!claims.isEmpty()&&claims.size()<=100,"Debt must identify 1..100 affected obligations");
        for(String id:claims)c.tx().require("claimHead",id);
        List<String> repayments=strings(r,"repaymentClaims");
        Problem.require(!repayments.isEmpty()&&repayments.size()<=100,"Debt must have explicit repayment obligations");
        for(String id:repayments)c.tx().require("claimHead",id);
        List<String> sources=strings(r,"sourceFindingIds");
        for(String id:sources)c.tx().require("finding",id);
        String id=c.uuid();
        Map<String,Object> debt=obj("id",id,"title",text(r,"title",300),"mechanism",text(r,"mechanism",8000),"futureChangeScenarios",list(r,"futureChangeScenarios"),"owner",text(r,"owner",120),"affectedClaims",claims,"repaymentClaims",repayments,"sourceFindingIds",sources,"principalEstimate",child(r,"principalEstimate"),"interestObservations",list(r,"interestObservations"),"proposedBy",c.actor().id(),"createdAt",c.now(),"state","PROPOSED","decisionVersion",0L,"trust","UNTRUSTED_PROPOSAL_UNTIL_REVIEWED");
        Problem.require(write(debt).length()<=100_000,"Debt proposal too large");
        c.tx().put("debt",id,0,debt);
        c.tx().links("debtClaim",id,new HashSet<>(claims));
        c.event("DEBT_PROPOSED",obj("id",id,"affectedClaims",claims));
        return debt;
    }
    static Map<String,Object> decide(Kernel.Ctx c,Map<String,Object> r) {
        String id=id(r,"id");
        Store.Doc d=c.tx().require("debt",id);
        Map<String,Object> debt=d.body();
        if(num(r,"expectedVersion",-1)!=d.version())throw Problem.conflict("Debt decision changed");
        String state=str(r,"state");
        Problem.require(Set.of("ACKNOWLEDGED","MITIGATED","ACCEPTED_EXCEPTION","REPAYING","REJECTED").contains(state),"Invalid debt decision");
        Problem.require(!str(debt,"state").equals("CLOSED"),"Closed debt cannot be reopened; create a new liability");
        String rationale=text(r,"rationale",8000);
        long expires=num(r,"expiresAt",0);
        Map<String,Object> pins=new TreeMap<>();
        if(state.equals("ACCEPTED_EXCEPTION")) {
            Problem.require(expires>c.now()&&expires<=c.now()+30L*86400_000,"Exceptions must expire within 30 days");
            for(String claim:strings(debt,"affectedClaims")) {
                Map<String,Object> definition=Claims.claim(c,claim);
                Problem.require(!bool(definition,"critical",true),"Critical requirements cannot be waived");
                Map<String,Object> head=c.tx().require("claimHead",claim).body();
                pins.put(claim,obj("revision",head.get("revision"),"generation",head.get("generation")));
            }
        }
        long decisionVersion=num(debt,"decisionVersion",0)+1;
        Map<String,Object> decision=obj("debtId",id,"version",decisionVersion,"state",state,"rationale",rationale,"expiresAt",expires,"claimPins",pins,"reviewer",c.actor().id(),"at",c.now());
        c.tx().put("debtDecision",id+"@"+decisionVersion,0,decision);
        debt.put("state",state);
        debt.put("decisionVersion",decisionVersion);
        debt.put("decision",decision);
        debt.put("trust","REVIEWED_DISPOSITION_NOT_PROOF");
        c.tx().put("debt",id,d.version(),debt);
        Claims.changePolicy(c);
        c.event("DEBT_DECIDED",decision);
        return obj("debt",debt,"version",d.version()+1);
    }
    static Optional<Map<String,Object>> exception(Kernel.Ctx c,String claim) {
        if(bool(Claims.claim(c,claim),"critical",true))return Optional.empty();
        Map<String,Object> head=c.tx().require("claimHead",claim).body();
        for(String id:c.tx().incoming("debtClaim",claim)) {
            Map<String,Object> debt=c.tx().require("debt",id).body();
            if(!str(debt,"state").equals("ACCEPTED_EXCEPTION"))continue;
            Map<String,Object> decision=child(debt,"decision");
            if(num(decision,"expiresAt",0)<=c.now())continue;
            Map<String,Object> pin=child(child(decision,"claimPins"),claim);
            if(num(pin,"revision",0)==num(head,"revision",0)&&num(pin,"generation",0)==num(head,"generation",0))return Optional.of(obj("debtId",id,"claimId",claim,"expiresAt",decision.get("expiresAt"),"decisionVersion",decision.get("version"),"truthUnchanged",true));
        }
        return Optional.empty();
    }
    static Map<String,Object> close(Kernel.Ctx c,Map<String,Object> r) {
        String id=id(r,"id");
        Store.Doc d=c.tx().require("debt",id);
        Map<String,Object> debt=d.body();
        if(num(r,"expectedVersion",-1)!=d.version())throw Problem.conflict("Debt changed");
        Problem.require(!Set.of("CLOSED","REJECTED","PROPOSED").contains(str(debt,"state")),"Debt must be acknowledged before verified closure");
        List<Object> repayment=new ArrayList<>();
        for(String claim:strings(debt,"repaymentClaims")) {
            Map<String,Object> status=Claims.assess(c,claim,new HashSet<>(),new HashMap<>());
            if(!str(status,"status").equals("SUPPORTED"))throw Problem.conflict("Repayment obligation is not currently supported");
            // Require at least one fresh evidence artifact for this repayment, not a pre-debt green badge.
            boolean fresh=false;
            for(Object raw:list(status,"evidenceKinds")) {
                Map<String,Object> e=c.tx().require("evidence",str(map(raw),"evidence")).body();
                if(num(e,"at",0)>num(debt,"createdAt",0))fresh=true;
            }
            Problem.require(fresh,"Repayment requires evidence produced after the debt was recorded");
            repayment.add(status);
        }
        Map<String,Object> closure=obj("id",c.uuid(),"debtId",id,"repayment",repayment,"rationale",text(r,"rationale",8000),"reviewer",c.actor().id(),"at",c.now());
        c.tx().put("debtClosure",str(closure,"id"),0,closure);
        debt.put("state","CLOSED");
        debt.put("closure",closure);
        c.tx().put("debt",id,d.version(),debt);
        Claims.changePolicy(c);
        c.event("DEBT_CLOSED",obj("debtId",id,"closure",closure.get("id")));
        return obj("debt",debt,"version",d.version()+1);
    }
    static Map<String,Object> listDebt(Kernel.Ctx c,Map<String,Object> r) {
        Map<String,Object> page=Kernel.page(c,"debt",r);
        for(Object raw:list(page,"items")) {
            Map<String,Object> debt=child(map(raw),"value");
            if(str(debt,"state").equals("ACCEPTED_EXCEPTION"))debt.put("exceptionExpired",num(child(debt,"decision"),"expiresAt",0)<=c.now());
        }
        return page;
    }
    static int expire(Kernel.Ctx c) {
        int count=0;
        String cursor=c.tx().get("meta","debtExpiryCursor").map(d->str(d.body(),"after","")).orElse("");
        List<Store.Doc> page=c.tx().page("debt",cursor,500);
        c.tx().upsert("meta","debtExpiryCursor",obj("after",page.size()==500?page.getLast().id():""));
        for(Store.Doc d:page) {
            Map<String,Object> debt=d.body();
            if(str(debt,"state").equals("ACCEPTED_EXCEPTION")&&num(child(debt,"decision"),"expiresAt",0)<=c.now()) {
                debt.put("state","EXPIRED");
                c.tx().put("debt",d.id(),d.version(),debt);
                c.event("DEBT_EXCEPTION_EXPIRED",obj("debtId",d.id()));
                count++;
            }
        }
        if(count>0)Claims.changePolicy(c);
        return count;
    }
}
