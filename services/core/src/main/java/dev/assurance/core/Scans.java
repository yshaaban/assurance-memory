package dev.assurance.core;
import java.util.*;
import static dev.assurance.core.Json.*;
/** Staged component scans and semantic invalidation. No repository source text is retained here. */ final class Scans {
    private static final int MAX_FACTS=50_000;
    private Scans() {
    }
    static Map<String,Object> start(Kernel.Ctx c,Map<String,Object> r) {
        String component=id(r,"component");
        Problem.require(component.length()<=50,"Component identifier must fit the storage partition key");
        String expected=r.get("expectedHead") instanceof String s?s:"";
        String actual=c.tx().get("head",component).map(d->str(d.body(),"head")).orElse("");
        if(!actual.equals(expected))throw Problem.conflict("Component head changed before scan start");
        long count=num(r,"expectedFacts",-1);
        Problem.require(count>=0&&count<=MAX_FACTS,"expectedFacts must be 0..50000; split larger components");
        String revision=text(r,"sourceRevision",160);
        Map<String,Object> coverage=child(r,"coverage");
        Problem.require(Set.of("COMPLETE","PARTIAL").contains(str(coverage,"discovery")),"Invalid discovery coverage");
        Problem.require(Set.of("RESOLVED","PARTIAL").contains(str(coverage,"semantic")),"Invalid semantic coverage");
        Problem.require(strings(coverage,"limitations").size()<=100,"Too many coverage limitations");
        Map<String,Object> environment=child(r,"environment");
        Problem.require(environment.size()<=100,"Too many environment dimensions");
        for(var e:environment.entrySet())Problem.require(e.getKey().matches("[A-Za-z0-9_.-]{1,80}")&&e.getValue() instanceof String s&&s.matches("[a-f0-9]{64}"),"Environment values must be opaque SHA-256 digests, not secrets or configuration values");
        String configDigest=str(r,"configurationDigest");
        Problem.require(configDigest.matches("[a-f0-9]{64}"),"configurationDigest must be SHA-256");
        List<String> rules=strings(r,"rulesExecuted");
        Problem.require(rules.size()<=300&&rules.stream().allMatch(s->s.matches("[A-Z0-9_]{1,80}")),"Invalid rule manifest");
        Map<String,Object> scan=obj("id",c.uuid(),"component",component,"expectedHead",expected,"sourceRevision",revision,"environment",environment,"configurationDigest",configDigest,"coverage",coverage,"analyzer",text(r,"analyzer",200),"rulesExecuted",rules,"expectedFacts",count,"actor",c.actor().id(),"createdAt",c.now(),"expiresAt",c.now()+3_600_000L,"status","STAGING");
        c.tx().put("scan",str(scan,"id"),0,scan);
        c.event("SCAN_STARTED",obj("scan",str(scan,"id"),"component",component));
        return scan;
    }
    static Map<String,Object> batch(Kernel.Ctx c,Map<String,Object> r) {
        Store.Doc document=c.tx().require("scan",id(r,"scanId"));
        Map<String,Object> scan=document.body();
        writableScan(c,scan);
        String component=str(scan,"component"),scanId=str(scan,"id");
        List<Object> facts=list(r,"facts"),findings=list(r,"findings");
        Problem.require(facts.size()<=500&&findings.size()<=500,"Batch size is at most 500 facts and 500 findings");
        for(Object o:facts) {
            Map<String,Object> f=validateFact(map(o),component);
            String id=str(f,"id");
            Optional<Store.Doc> existing=c.tx().get("stage."+scanId,id);
            if(existing.isPresent()) {
                if(!hash(existing.get().body()).equals(hash(f)))throw Problem.conflict("Different fact submitted twice within one scan");
            }
            else c.tx().put("stage."+scanId,id,0,f);
        }
        for(Object o:findings) {
            Map<String,Object> f=validateFinding(map(o),component,scanId,c.now());
            String id=str(f,"id");
            Optional<Store.Doc> existing=c.tx().get("stageFinding."+scanId,id);
            if(existing.isPresent()) {
                if(!hash(existing.get().body()).equals(hash(f)))throw Problem.conflict("Different finding submitted twice within one scan");
            }
            else c.tx().put("stageFinding."+scanId,id,0,f);
        }
        return obj("scanId",scanId,"acceptedFacts",facts.size(),"acceptedFindings",findings.size());
    }
    private static void writableScan(Kernel.Ctx c,Map<String,Object> scan) {
        if(!str(scan,"actor").equals(c.actor().id()))throw new Problem(403,"FORBIDDEN","Scan belongs to another scanner");
        if(!str(scan,"status").equals("STAGING")||num(scan,"expiresAt",0)<=c.now())throw Problem.conflict("Scan is closed or expired");
    }
    private static Map<String,Object> validateFact(Map<String,Object> f,String component) {
        String locator=text(f,"locator",1500),path=text(f,"path",1000);
        Problem.require(!path.startsWith("/")&&!path.contains("\\")&&!Arrays.asList(path.split("/")).contains(".."),"Path must be repository-relative");
        String identity=sha(component+":"+locator);
        Problem.require(identity.equals(str(f,"id")),"Subject ID does not match its component and locator");
        String content=str(f,"contentHash");
        Problem.require(content.matches("[a-f0-9]{64}"),"contentHash must be SHA-256");
        String signature=str(f,"signatureHash",content);
        Problem.require(signature.matches("[a-f0-9]{64}"),"signatureHash must be SHA-256");
        List<String> tags=new ArrayList<>(strings(f,"tags"));
        Problem.require(tags.size()<=80&&tags.stream().allMatch(s->s.matches("[A-Za-z0-9_.-]{1,80}")),"Invalid subject tags");
        if(!tags.contains("all"))tags.add("all");
        tags=tags.stream().distinct().sorted().toList();
        List<String> effects=strings(f,"effects");
        Problem.require(effects.size()<=120&&effects.stream().allMatch(s->s.length()<=200),"Invalid effect summary");
        Map<String,Object> metrics=child(f,"metrics");
        Problem.require(metrics.size()<=40,"Too many metrics");
        for(var e:metrics.entrySet())Problem.require(e.getValue() instanceof Number,"Metrics must be numeric");
        Map<String,Object> body=obj("id",identity,"component",component,"locator",locator,"path",path,"language",text(f,"language",20),"kind",text(f,"kind",40),"contentHash",content,"signatureHash",signature,"tags",tags,"effects",effects.stream().distinct().sorted().toList(),"metrics",metrics,"line",num(f,"line",1));
        body.put("fingerprint",hash(body));
        return body;
    }
    private static Map<String,Object> validateFinding(Map<String,Object> f,String component,String scan,long now) {
        String rule=text(f,"ruleId",80);
        Problem.require(rule.matches("[A-Z0-9_]+"),"Invalid rule ID");
        String subject=str(f,"subjectId");
        Problem.require(subject.matches("[a-f0-9]{64}"),"Finding subject must be a subject digest");
        String severity=str(f,"severity","MEDIUM");
        Problem.require(Set.of("HIGH","MEDIUM","LOW").contains(severity),"Invalid finding severity");
        long line=num(f,"line",1);
        Problem.require(line>0,"Invalid finding line");
        // Identity excludes scan and line to survive harmless line-number movement. Multiple same-rule findings aggregate per subject.
        return obj("id",sha(component+":"+subject+":"+rule),"component",component,"subjectId",subject,"ruleId",rule,"severity",severity,"line",line,"message",text(f,"message",1000),"certainty","CANDIDATE","state","OPEN","scanId",scan,"firstSeen",now,"lastSeen",now,"trust","UNTRUSTED_ANALYZER_DIAGNOSTIC");
    }
    static Map<String,Object> commit(Kernel.Ctx c,Map<String,Object> r) {
        String scanId=id(r,"scanId");
        Store.Doc scanDoc=c.tx().require("scan",scanId);
        Map<String,Object> scan=scanDoc.body();
        writableScan(c,scan);
        String component=str(scan,"component");
        Optional<Store.Doc> oldHead=c.tx().get("head",component);
        String current=oldHead.map(d->str(d.body(),"head")).orElse("");
        if(!current.equals(str(scan,"expectedHead","")))throw Problem.conflict("Component head changed; rescan/rebase instead of overwriting another agent");
        List<Store.Doc> staged=c.tx().all("stage."+scanId,MAX_FACTS);
        Problem.require(staged.size()==num(scan,"expectedFacts",-1),"Scan is incomplete: staged fact count differs from its manifest");
        List<Store.Doc> old=c.tx().all("fact."+component,MAX_FACTS);
        Map<String,Map<String,Object>> oldMap=new TreeMap<>(),next=new TreeMap<>();
        old.forEach(d->oldMap.put(d.id(),d.body()));
        boolean complete=str(child(scan,"coverage"),"discovery").equals("COMPLETE");
        if(!complete)next.putAll(oldMap);
        staged.forEach(d->next.put(d.id(),d.body()));
        Problem.require(next.size()<=MAX_FACTS,"Partition limit exceeded");
        Set<String> changed=new TreeSet<>(),allIds=new TreeSet<>(oldMap.keySet());
        allIds.addAll(next.keySet());
        Map<String,Map<String,Object>> currentFindings=new LinkedHashMap<>();
        for(Store.Doc d:c.tx().all("stageFinding."+scanId,MAX_FACTS)) {
            Problem.require(next.containsKey(str(d.body(),"subjectId")),"Finding references a missing subject");
            Problem.require(strings(scan,"rulesExecuted").contains(str(d.body(),"ruleId")),"Finding rule is absent from the executed-rule manifest");
            currentFindings.put(d.id(),d.body());
        }
        for(String id:allIds) {
            Map<String,Object> before=oldMap.get(id),after=next.get(id);
            String b=before==null?"ABSENT":str(before,"fingerprint"),a=after==null?"ABSENT":str(after,"fingerprint");
            if(b.equals(a))continue;
            changed.add("subject:"+component+":"+id);
            setFingerprint(c,"subject:"+component+":"+id,a);
            if(after==null) {
                Store.Doc d=c.tx().require("fact."+component,id);
                c.tx().delete("fact."+component,id,d.version());
            }
            else c.tx().upsert("fact."+component,id,after);
            if(before!=null&&after!=null)deltaFindings(c,component,scanId,before,after,currentFindings);
        }
        Map<String,List<Object>> scopes=new TreeMap<>();
        for(var f:next.values())for(String tag:strings(f,"tags"))scopes.computeIfAbsent(tag,k->new ArrayList<>()).add(List.of(str(f,"id"),str(f,"fingerprint")));
        Set<String> allScopes=new TreeSet<>(scopes.keySet());
        oldMap.values().forEach(f->allScopes.addAll(strings(f,"tags")));
        allScopes.add("all");
        for(String tag:allScopes) {
            String key="scope:"+component+":"+tag,digest=hash(scopes.getOrDefault(tag,List.of()));
            if(!fingerprint(c,key).equals(digest)) {
                setFingerprint(c,key,digest);
                changed.add(key);
            }
        }
        String componentDigest=hash(next.values().stream().map(f->List.of(str(f,"id"),str(f,"fingerprint"))).toList());
        String componentKey="component:"+component;
        if(!fingerprint(c,componentKey).equals(componentDigest)) {
            setFingerprint(c,componentKey,componentDigest);
            changed.add(componentKey);
        }
        String contextKey="context:"+component,contextDigest=hash(obj("environment",scan.get("environment"),"configurationDigest",scan.get("configurationDigest"),"analyzer",scan.get("analyzer"),"coverage",scan.get("coverage"),"rulesExecuted",scan.get("rulesExecuted")));
        if(!fingerprint(c,contextKey).equals(contextDigest)) {
            setFingerprint(c,contextKey,contextDigest);
            changed.add(contextKey);
        }
        String contentDigest=hash(obj("facts",componentDigest,"context",contextDigest,"sourceRevision",scan.get("sourceRevision")));
        long ordinal=oldHead.map(d->num(d.body(),"ordinal",0)).orElse(0L)+1;
        boolean checkpoint=ordinal==1||ordinal%100==0;
        String newHead=oldHead.isPresent()&&str(oldHead.get().body(),"contentDigest").equals(contentDigest)?current:hash(obj("parent",current,"content",contentDigest));
        Map<String,Object> head=obj("component",component,"head",newHead,"parent",current,"contentDigest",contentDigest,"sourceRevision",scan.get("sourceRevision"),"coverage",scan.get("coverage"),"environment",scan.get("environment"),"configurationDigest",scan.get("configurationDigest"),"analyzer",scan.get("analyzer"),"contextDigest",contextDigest,"factCount",next.size(),"ordinal",ordinal,"checkpoint",checkpoint,"at",c.now(),"scanId",scanId);
        if(!newHead.equals(current)) {
            for(String id:allIds) {
                Map<String,Object> before=oldMap.get(id),after=next.get(id);
                boolean difference=!Objects.equals(before==null?null:before.get("fingerprint"),after==null?null:after.get("fingerprint"));
                if(after!=null&&(difference||checkpoint)) {
                    String digest=str(after,"fingerprint");
                    if(c.tx().get("factArtifact",digest).isEmpty())c.tx().put("factArtifact",digest,0,after);
                }
                if(difference||checkpoint) {
                    c.tx().put("delta."+newHead,id,0,obj("subjectId",id,"fingerprint",after==null?null:after.get("fingerprint"),"deleted",after==null));
                }
                if(difference) {
                    Map<String,Object> churn=c.tx().get("churn."+component,id).map(Store.Doc::body).orElse(obj("changes",0L,"firstSeen",c.now()));
                    churn.put("changes",num(churn,"changes",0)+1);
                    churn.put("lastChanged",c.now());
                    churn.put("path",after==null?before.get("path"):after.get("path"));
                    c.tx().upsert("churn."+component,id,churn);
                }
            }
            c.tx().upsert("head",component,head);
            c.tx().put("snapshot",newHead,0,head);
        }
        else head=oldHead.orElseThrow().body();
        updateFindings(c,component,scan,currentFindings,complete);
        Set<String> roots=new TreeSet<>();
        for(String key:changed)roots.addAll(c.tx().incoming("watch",sha(key)));
        Set<String> impacted=Claims.invalidate(c,roots,"SNAPSHOT_CHANGED",obj("component",component,"head",newHead,"changedKeys",changed.stream().limit(100).toList(),"changedKeyCount",changed.size()));
        scan.put("status","COMMITTED");
        scan.put("head",newHead);
        scan.put("committedAt",c.now());
        c.tx().put("scan",scanId,scanDoc.version(),scan);
        for(Store.Doc d:staged)c.tx().delete("stage."+scanId,d.id(),d.version());
        for(Store.Doc d:c.tx().all("stageFinding."+scanId,MAX_FACTS))c.tx().delete("stageFinding."+scanId,d.id(),d.version());
        c.event("SNAPSHOT_PUBLISHED",obj("component",component,"head",newHead,"parent",current,"changedKeyCount",changed.size(),"impactedClaims",impacted));
        return obj("head",head,"impactedClaims",impacted,"changedKeyCount",changed.size(),"changedKeys",changed.stream().limit(1000).toList(),"changedKeysTruncated",changed.size()>1000);
    }
    private static void deltaFindings(Kernel.Ctx c,String component,String scan,Map<String,Object> before,Map<String,Object> after,Map<String,Map<String,Object>> findings) {
        if(!str(before,"signatureHash").equals(str(after,"signatureHash"))&&strings(after,"tags").contains("boundaries"))addDelta(c,component,scan,after,"DELTA_API_SIGNATURE","Public signature changed; review consumers and mixed-version deployments",findings);
        if(!hash(before.get("effects")).equals(hash(after.get("effects"))))addDelta(c,component,scan,after,"DELTA_EFFECTS","Effect summary changed; reassess ownership, cancellation and boundary contracts",findings);
        if(num(child(after,"metrics"),"assertions",0)<num(child(before,"metrics"),"assertions",0))addDelta(c,component,scan,after,"DELTA_TEST_ASSERTIONS","Assertion count decreased; this is a test-weakening candidate, not a semantic conclusion",findings);
        if(num(child(after,"metrics"),"guards",0)<num(child(before,"metrics"),"guards",0))addDelta(c,component,scan,after,"DELTA_GUARD_REMOVAL","Guard count decreased; review lost preconditions and terminal-state arbitration",findings);
        if(strings(before,"tags").contains("migrations"))addDelta(c,component,scan,after,"DELTA_MIGRATION_MUTATED","Previously observed migration content changed; check already-deployed schema histories",findings);
    }
    private static void addDelta(Kernel.Ctx c,String component,String scan,Map<String,Object> subject,String rule,String message,Map<String,Map<String,Object>> out) {
        Map<String,Object> f=validateFinding(obj("ruleId",rule,"subjectId",subject.get("id"),"line",subject.get("line"),"severity","HIGH","message",message),component,scan,c.now());
        out.put(str(f,"id"),f);
    }
    private static void updateFindings(Kernel.Ctx c,String component,Map<String,Object> scan,Map<String,Map<String,Object>> current,boolean complete) {
        for(String id:c.tx().incoming("findingComponent",component)) {
            Store.Doc d=c.tx().require("finding",id);
            Map<String,Object> old=d.body();
            Map<String,Object> next=current.remove(id);
            if(next!=null) {
                next.put("firstSeen",old.get("firstSeen"));
                c.tx().put("finding",id,d.version(),next);
            }
            else if(str(old,"state").equals("OPEN")) {
                old.put("state",complete&&(strings(scan,"rulesExecuted").contains(str(old,"ruleId"))||str(old,"ruleId").startsWith("DELTA_"))?"NOT_OBSERVED":"UNKNOWN");
                old.put("lastEvaluated",c.now());
                c.tx().put("finding",id,d.version(),old);
            }
        }
        for(var e:current.entrySet()) {
            c.tx().put("finding",e.getKey(),0,e.getValue());
            c.tx().links("findingComponent",e.getKey(),Set.of(component));
        }
    }
    static String fingerprint(Kernel.Ctx c,String key) {
        return c.tx().get("fingerprint",sha(key)).map(d->str(d.body(),"digest")).orElse(key.startsWith("scope:")?hash(List.of()):"ABSENT");
    }
    private static void setFingerprint(Kernel.Ctx c,String key,String digest) {
        c.tx().upsert("fingerprint",sha(key),obj("selector",key,"digest",digest));
    }
    static Map<String,Object> historicalSubject(Kernel.Ctx c,Map<String,Object> r) {
        String head=id(r,"head"),subject=id(r,"subjectId");
        int traversed=0;
        String cursor=head;
        while(!cursor.isEmpty()) {
            if(++traversed>101)throw new IllegalStateException("Snapshot checkpoint invariant failed");
            Map<String,Object> snapshot=c.tx().require("snapshot",cursor).body();
            Optional<Store.Doc> delta=c.tx().get("delta."+cursor,subject);
            if(delta.isPresent()) {
                Map<String,Object> value=delta.get().body();
                return obj("head",head,"subject",bool(value,"deleted",false)?null:c.tx().require("factArtifact",str(value,"fingerprint")).body(),"traversed",traversed);
            }
            if(bool(snapshot,"checkpoint",false))break;
            cursor=str(snapshot,"parent","");
        }
        return obj("head",head,"subject",null,"traversed",traversed);
    }
    static int expire(Kernel.Ctx c) {
        int count=0;
        String cursor=c.tx().get("meta","scanExpiryCursor").map(d->str(d.body(),"after","")).orElse("");
        List<Store.Doc> page=c.tx().page("scan",cursor,500);
        c.tx().upsert("meta","scanExpiryCursor",obj("after",page.size()==500?page.getLast().id():""));
        for(Store.Doc d:page) {
            Map<String,Object> s=d.body();
            if(str(s,"status").equals("STAGING")&&num(s,"expiresAt",0)<=c.now()) {
                for(String prefix:List.of("stage.","stageFinding."))for(Store.Doc row:c.tx().all(prefix+d.id(),MAX_FACTS))c.tx().delete(prefix+d.id(),row.id(),row.version());
                s.put("status","EXPIRED");
                c.tx().put("scan",d.id(),d.version(),s);
                count++;
            }
        }
        return count;
    }
}
