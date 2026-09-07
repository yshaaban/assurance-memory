package dev.assurance.core;
import com.sun.source.tree.*;
import com.sun.source.util.*;
import javax.lang.model.element.Modifier;
import javax.tools.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static dev.assurance.core.Json.*;
/** JDK AST adapter. Server mode parses source only and explicitly reports partial semantics.
* Optional local mode resolves against an operator-supplied build classpath, with annotation processing disabled.
* Pattern findings are candidates, not proof of a defect. Reflection and framework proxies remain modeled assumptions. */
public final class JavaAnalyzer {
    public static final String VERSION="jdk-tree-21/1.0.0";
    public static final List<String> RULES=List.of("SPRING_SELF_INVOCATION","SPRING_ASYNC_SELF_INVOCATION","SPRING_PRIVATE_TRANSACTION","SPRING_FIELD_INJECTION","SPRING_REACTIVE_BLOCK","JAVA_EMPTY_CATCH","JAVA_INTERRUPTION_SWALLOWED","JAVA_UNBOUNDED_EXECUTOR","JAVA_EXECUTOR_CLEANUP","JAVA_THREADLOCAL_CLEANUP","JAVA_CANCEL_IS_NOT_STOP","JAVA_REFLECTION_UNKNOWN","JAVA_TEST_DISABLED","JAVA_MANUAL_RESOURCE","JAVA_LARGE_METHOD","JAVA_SQL_CONCATENATION");
    private final boolean allowLocalClassPath;
    public JavaAnalyzer() {
        this(false);
    }
    public JavaAnalyzer(boolean allowLocalClassPath) {
        this.allowLocalClassPath=allowLocalClassPath;
    }
    private static final class Source extends SimpleJavaFileObject {
        final String path,text;
        Source(String path,String text) {
            super(uri(path),Kind.SOURCE);
            this.path=path;
            this.text=text;
        }
        private static URI uri(String path) {
            try {
                return new URI("memory",null,"/"+path,null);
            }
            catch(Exception e) {
                throw Problem.bad("Invalid source path");
            }
        }
        @Override public CharSequence getCharContent(boolean ignore) {
            return text;
        }
    }
    public Map<String,Object> analyze(Map<String,Object> request) {
        String component=id(request,"component");
        List<Object> raw=list(request,"files");
        Problem.require(raw.size()<=2000,"Java analysis batch limit is 2000 files");
        List<Source> sources=new ArrayList<>();
        Set<String> paths=new HashSet<>();
        long bytes=0;
        for(Object o:raw) {
            Map<String,Object> f=map(o);
            String path=text(f,"path",1000),source=str(f,"source","");
            Problem.require(path.endsWith(".java")&&!path.startsWith("/")&&!path.contains("\\")&&!Arrays.asList(path.split("/")).contains("..")&&paths.add(path),"Invalid or duplicate Java source path");
            bytes+=source.getBytes(StandardCharsets.UTF_8).length;
            Problem.require(bytes<=5_000_000,"Java analysis batch exceeds five megabytes");
            sources.add(new Source(path,source));
        }
        boolean resolve=bool(request,"resolveTypes",false);
        Problem.require(!resolve||allowLocalClassPath,"Remote analysis cannot access server classpaths; use the local JDK adapter for attribution");
        JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();
        if(compiler==null)throw new Problem(503,"JDK_REQUIRED","A full JDK, not a JRE, is required for Java analysis");
        DiagnosticCollector<JavaFileObject> diagnostics=new DiagnosticCollector<>();
        List<Object> facts=new ArrayList<>(),findings=new ArrayList<>();
        boolean errors=false,unknown=false;
        if(sources.isEmpty())return obj("facts",facts,"findings",findings,"rulesExecuted",RULES,"analyzer",VERSION,"coverage",obj("discovery","COMPLETE","semantic",resolve?"RESOLVED":"PARTIAL","limitations",List.of("No Java source files supplied")));
        try(StandardJavaFileManager manager=compiler.getStandardFileManager(diagnostics,Locale.ROOT,StandardCharsets.UTF_8)) {
            List<String> options=new ArrayList<>(List.of("-proc:none","-Xlint:none","--release","21"));
            if(resolve) {
                List<String> classpath=strings(request,"classpath");
                Problem.require(classpath.size()<=2000,"Classpath too large");
                options.add("-classpath");
                options.add(String.join(java.io.File.pathSeparator,classpath));
            }
            JavacTask task=(JavacTask)compiler.getTask(null,manager,diagnostics,options,null,sources);
            List<CompilationUnitTree> units=new ArrayList<>();
            task.parse().forEach(units::add);
            boolean parseErrors=diagnostics.getDiagnostics().stream().anyMatch(d->d.getKind()==Diagnostic.Kind.ERROR);
            if(resolve&&!parseErrors)task.analyze();
            errors=diagnostics.getDiagnostics().stream().anyMatch(d->d.getKind()==Diagnostic.Kind.ERROR);
            Trees trees=Trees.instance(task);
            for(CompilationUnitTree unit:units) {
                Source source=sources.stream().filter(s->s.toUri().equals(unit.getSourceFile().toUri())).findFirst().orElseThrow();
                Extractor extractor=new Extractor(component,source,unit,trees,facts,findings,resolve&&!errors);
                extractor.scan(unit,null);
                extractor.finish();
                unknown|=extractor.unknown;
            }
            List<String> limitations=new ArrayList<>();
            if(!resolve)limitations.add("Parsed AST only: build classpath, generated types and symbol attribution were not supplied");
            if(errors)limitations.add("Compiler diagnostics indicate incomplete parsing or attribution");
            if(unknown)limitations.add("Reflection or dynamic dispatch sites need framework/runtime models");
            limitations.add("Spring interception and resource findings are review candidates; no interprocedural proof is performed");
            return obj("facts",facts,"findings",findings,"rulesExecuted",RULES,"analyzer",VERSION,"coverage",obj("discovery",parseErrors?"PARTIAL":"COMPLETE","semantic",resolve&&!errors&&!unknown?"RESOLVED":"PARTIAL","limitations",limitations),"diagnostics",diagnostics.getDiagnostics().stream().limit(100).map(d->obj("kind",d.getKind().toString(),"code",d.getCode(),"line",d.getLineNumber())).toList());
        }
        catch(java.io.IOException e) {
            throw new Problem(500,"JAVA_ANALYSIS_FAILED","Java compiler I/O failed");
        }
    }
    private static final class ClassInfo {
        final String name;
        final Map<String,Set<String>> methodAnnotations=new HashMap<>();
        final Set<String> annotations;
        ClassInfo(ClassTree node) {
            name=node.getSimpleName().toString();
            annotations=annotationNames(node.getModifiers());
            for(Tree member:node.getMembers())if(member instanceof MethodTree m)methodAnnotations.computeIfAbsent(m.getName().toString(),k->new HashSet<>()).addAll(annotationNames(m.getModifiers()));
        }
    }
    private static Set<String> annotationNames(ModifiersTree modifiers) {
        Set<String> out=new HashSet<>();
        for(AnnotationTree a:modifiers.getAnnotations()) {
            String s=a.getAnnotationType().toString();
            out.add(s.substring(s.lastIndexOf('.')+1));
        }
        return out;
    }
    private static String callName(MethodInvocationTree call) {
        Tree select=call.getMethodSelect();
        return select instanceof MemberSelectTree m?m.getIdentifier().toString():select.toString();
    }
    private static final class Extractor extends TreePathScanner<Void,Void> {
        final String component;
        final Source source;
        final CompilationUnitTree unit;
        final Trees trees;
        final List<Object> facts,findings;
        final boolean resolved;
        final Deque<ClassInfo> classes=new ArrayDeque<>();
        final Set<String> fileCalls=new HashSet<>();
        final List<Map<String,Object>> cleanupCandidates=new ArrayList<>();
        final Map<String,Map<String,Object>> dedup=new LinkedHashMap<>();
        boolean unknown;
        Extractor(String component,Source source,CompilationUnitTree unit,Trees trees,List<Object> facts,List<Object> findings,boolean resolved) {
            this.component=component;
            this.source=source;
            this.unit=unit;
            this.trees=trees;
            this.facts=facts;
            this.findings=findings;
            this.resolved=resolved;
        }
        long line(Tree tree) {
            long p=trees.getSourcePositions().getStartPosition(unit,tree);
            return p<0?1:unit.getLineMap().getLineNumber(p);
        }
        String fragment(Tree tree) {
            long a=trees.getSourcePositions().getStartPosition(unit,tree),b=trees.getSourcePositions().getEndPosition(unit,tree);
            return a>=0&&b>=a&&b<=source.text.length()?source.text.substring((int)a,(int)b):tree.toString();
        }
        String subject(String locator) {
            return sha(component+":"+locator);
        }
        void finding(String subject,String rule,long line,String severity,String message) {
            Map<String,Object> f=obj("subjectId",subject,"ruleId",rule,"line",line,"severity",severity,"message",message);
            dedup.putIfAbsent(subject+":"+rule,f);
        }
        @Override public Void visitClass(ClassTree node,Void p) {
            classes.push(new ClassInfo(node));
            super.visitClass(node,p);
            classes.pop();
            return null;
        }
        @Override public Void visitVariable(VariableTree node,Void p) {
            if(getCurrentPath().getParentPath()!=null&&getCurrentPath().getParentPath().getLeaf() instanceof ClassTree&&annotationNames(node.getModifiers()).contains("Autowired"))finding(subject(source.path+"#file"),"SPRING_FIELD_INJECTION",line(node),"LOW","Field injection hides construction dependencies; consider an explicit constructor contract");
            return super.visitVariable(node,p);
        }
        @Override public Void visitMethod(MethodTree method,Void p) {
            if(classes.isEmpty())return super.visitMethod(method,p);
            String owner=classes.stream().map(x->x.name).reduce((a,b)->b+"."+a).orElse("");
            String signature=method.getName()+"("+String.join(",",method.getParameters().stream().map(v->v.getType().toString()).toList())+")";
            String locator=source.path+"#"+owner+"."+signature,id=subject(locator);
            Set<String> annotations=annotationNames(method.getModifiers());
            Set<String> tags=new TreeSet<>(Set.of("all","methods"));
            Set<String> effects=new TreeSet<>();
            if(method.getModifiers().getFlags().contains(Modifier.PUBLIC)||annotations.stream().anyMatch(s->s.endsWith("Mapping")))tags.add("boundaries");
            if(source.path.contains("/test/")||source.path.endsWith("Test.java")||annotations.contains("Test"))tags.add("tests");
            if(annotations.contains("Transactional")||classes.peek().annotations.contains("Transactional")) {
                tags.add("transactions");
                effects.add("TRANSACTION_DECLARATION");
            }
            if(annotations.contains("Async")) {
                tags.add("async");
                effects.add("ASYNC_DECLARATION");
            }
            if(annotations.contains("PreAuthorize")||annotations.contains("Secured")) {
                tags.add("security");
                effects.add("AUTHORIZATION_DECLARATION");
            }
            if(annotations.contains("Transactional")&&method.getModifiers().getFlags().contains(Modifier.PRIVATE))finding(id,"SPRING_PRIVATE_TRANSACTION",line(method),"HIGH","Private transactional method may not be intercepted in Spring proxy mode");
            if(annotations.contains("Disabled")||annotations.contains("Ignore"))finding(id,"JAVA_TEST_DISABLED",line(method),"HIGH","Test is disabled; evidence coverage may have narrowed");
            final long[] guards= {
                0
            },assertions= {
                0
            };
            Set<String> calls=new HashSet<>();
            ClassInfo enclosing=classes.peek();
            if(method.getBody()!=null)new TreePathScanner<Void,Void>() {
                @Override public Void visitIf(IfTree n,Void x) {
                    guards[0]++;
                    return super.visitIf(n,x);
                }
                @Override public Void visitSwitch(SwitchTree n,Void x) {
                    guards[0]+=n.getCases().size();
                    return super.visitSwitch(n,x);
                }
                @Override public Void visitMethodInvocation(MethodInvocationTree n,Void x) {
                    String name=callName(n);
                    calls.add(name);
                    fileCalls.add(name);
                    String lower=name.toLowerCase(Locale.ROOT);
                    if(name.startsWith("assert")||name.equals("verify"))assertions[0]++;
                    if(Set.of("save","saveAll","delete","deleteById","update","executeUpdate","persist","merge").contains(name)) {
                        effects.add("WRITE_DB");
                        tags.add("writers");
                    }
                    if(Set.of("findById","findAll","query","executeQuery").contains(name)) {
                        effects.add("READ_DB");
                        tags.add("readers");
                    }
                    if(Set.of("send","publish","convertAndSend").contains(name)) {
                        effects.add("PUBLISH");
                        tags.add("publishers");
                    }
                    if(Set.of("runAsync","supplyAsync","submit","schedule","execute").contains(name)) {
                        effects.add("SPAWN");
                        tags.add("async");
                    }
                    if(Set.of("close","shutdown","shutdownNow","remove").contains(name)) {
                        effects.add("RELEASE");
                        tags.add("resources");
                    }
                    if(Set.of("getConnection","lock","acquire").contains(name)) {
                        effects.add("ACQUIRE");
                        tags.add("resources");
                    }
                    if(name.equals("cancel")) {
                        effects.add("CANCEL_REQUEST");
                        finding(id,"JAVA_CANCEL_IS_NOT_STOP",line(n),"MEDIUM","Cancellation is a request/result state; establish separately whether underlying work and side effects stop");
                    }
                    if(Set.of("sleep","join","get","block","blockLast","blockFirst").contains(name))effects.add("MAY_BLOCK");
                    if(Set.of("block","blockLast","blockFirst").contains(name)&&(String.valueOf(method.getReturnType()).contains("Mono")||String.valueOf(method.getReturnType()).contains("Flux")))finding(id,"SPRING_REACTIVE_BLOCK",line(n),"HIGH","Blocking call appears in a reactive-returning method; review scheduler and event-loop assumptions");
                    if(Set.of("forName","getDeclaredMethod","getDeclaredField","invoke").contains(name)) {
                        unknown=true;
                        tags.add("unknown");
                        effects.add("REFLECTION");
                        finding(id,"JAVA_REFLECTION_UNKNOWN",line(n),"MEDIUM","Reflective behavior is outside this adapter's resolved call graph");
                    }
                    if(Set.of("newCachedThreadPool","newFixedThreadPool","newSingleThreadExecutor").contains(name)) {
                        tags.add("resources");
                        effects.add("CREATE_EXECUTOR");
                        finding(id,"JAVA_UNBOUNDED_EXECUTOR",line(n),"HIGH","Executor factory may have an unbounded thread count or queue; declare admission and shutdown budgets");
                        cleanupCandidates.add(obj("id",id,"kind","executor","line",line(n)));
                    }
                    boolean self=!(n.getMethodSelect() instanceof MemberSelectTree member)||member.getExpression().toString().equals("this");
                    Set<String> target=enclosing.methodAnnotations.getOrDefault(name,Set.of());
                    if(self&&target.contains("Transactional"))finding(id,"SPRING_SELF_INVOCATION",line(n),"HIGH","Local call to transactional method bypasses default proxy interception; propagation settings may not apply");
                    if(self&&target.contains("Async"))finding(id,"SPRING_ASYNC_SELF_INVOCATION",line(n),"HIGH","Local call to @Async method may bypass proxy scheduling");
                    if(Set.of("executeQuery","executeUpdate","query").contains(name)&&n.getArguments().stream().anyMatch(a->a instanceof BinaryTree b&&b.getKind()==Tree.Kind.PLUS))finding(id,"JAVA_SQL_CONCATENATION",line(n),"HIGH","SQL argument uses concatenation; verify trusted inputs and parameter binding");
                    if(resolved) {
                        var element=trees.getElement(getCurrentPath());
                        if(element!=null) {
                            String targetName=element.getEnclosingElement()+"#"+element.getSimpleName();
                            if(targetName.length()<160)effects.add("CALL:"+targetName);
                        }
                    }
                    return super.visitMethodInvocation(n,x);
                }
                @Override public Void visitCatch(CatchTree n,Void x) {
                    if(n.getBlock().getStatements().isEmpty())finding(id,"JAVA_EMPTY_CATCH",line(n),"HIGH","Empty catch may discard failures and break recovery obligations");
                    String type=n.getParameter().getType().toString();
                    if(type.contains("InterruptedException")) {
                        boolean[] restored= {
                            false
                        };
                        new TreeScanner<Void,Void>() {
                            @Override public Void visitThrow(ThrowTree t,Void p) {
                                restored[0]=true;
                                return super.visitThrow(t,p);
                            }
                            @Override public Void visitMethodInvocation(MethodInvocationTree t,Void p) {
                                if(callName(t).equals("interrupt"))restored[0]=true;
                                return super.visitMethodInvocation(t,p);
                            }
                        }.scan(n.getBlock(),null);
                        if(!restored[0])finding(id,"JAVA_INTERRUPTION_SWALLOWED",line(n),"HIGH","InterruptedException is caught without an obvious rethrow or interrupt restoration");
                    }
                    return super.visitCatch(n,x);
                }
                @Override public Void visitNewClass(NewClassTree n,Void x) {
                    String type=n.getIdentifier().toString();
                    if(type.contains("ThreadLocal")) {
                        tags.add("resources");
                        cleanupCandidates.add(obj("id",id,"kind","threadlocal","line",line(n)));
                    }
                    if(Set.of("FileInputStream","FileOutputStream","Socket","Scanner").stream().anyMatch(type::endsWith)) {
                        tags.add("resources");
                        effects.add("ACQUIRE");
                        boolean managed=false;
                        TreePath path=getCurrentPath();
                        while(path!=null&&path.getLeaf()!=method) {
                            if(path.getLeaf() instanceof TryTree t&&t.getResources().stream().anyMatch(resource->fragment(resource).contains(fragment(n))))managed=true;
                            path=path.getParentPath();
                        }
                        if(!managed)finding(id,"JAVA_MANUAL_RESOURCE",line(n),"MEDIUM","Resource creation is outside an obvious try-with-resources declaration; verify ownership transfer and exceptional cleanup");
                    }
                    return super.visitNewClass(n,x);
                }
            }.scan(new TreePath(getCurrentPath(),method.getBody()),null);
            long lines=fragment(method).lines().count();
            if(lines>100)finding(id,"JAVA_LARGE_METHOD",line(method),"LOW","Large method is a change-locality and review-cost candidate, not a debt valuation");
            Map<String,Object> fact=obj("id",id,"locator",locator,"path",source.path,"language","JAVA","kind","METHOD","contentHash",sha(fragment(method)),"signatureHash",sha(method.getModifiers()+":"+method.getReturnType()+":"+signature),"tags",tags,"effects",effects.stream().limit(120).toList(),"metrics",obj("lines",lines,"guards",guards[0],"assertions",assertions[0]),"line",line(method));
            facts.add(fact);
            return super.visitMethod(method,p);
        }
        void finish() {
            String fileId=subject(source.path+"#file");
            Set<String> tags=new TreeSet<>(Set.of("all","files"));
            if(source.path.contains("/test/")||source.path.endsWith("Test.java"))tags.add("tests");
            if(unknown)tags.add("unknown");
            if(source.text.contains("ThreadLocal<")&&!fileCalls.contains("remove"))finding(fileId,"JAVA_THREADLOCAL_CLEANUP",1,"MEDIUM","Thread-local storage is present without same-file remove; cross-file cleanup remains unresolved");
            for(var candidate:cleanupCandidates)if(str(candidate,"kind").equals("executor")&&!fileCalls.contains("shutdown")&&!fileCalls.contains("shutdownNow"))finding(str(candidate,"id"),"JAVA_EXECUTOR_CLEANUP",num(candidate,"line",1),"MEDIUM","Executor allocation has no same-file shutdown; establish service lifecycle ownership");
            facts.add(obj("id",fileId,"locator",source.path+"#file","path",source.path,"language","JAVA","kind","FILE","contentHash",sha(source.text),"signatureHash",sha("JAVA_FILE"),"tags",tags,"effects",List.of(),"metrics",obj("lines",source.text.lines().count()),"line",1));
            findings.addAll(dedup.values());
        }
    }
}
