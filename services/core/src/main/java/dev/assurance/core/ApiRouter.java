package dev.assurance.core;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicLong;
import static dev.assurance.core.Json.*;
/** The same API/auth boundary is used by the Spring adapter and the offline integration harness. */ public final class ApiRouter {
    public static final int MAX_BODY=8_000_000;
    public record Response(int status,Map<String,String> headers,byte[] body) {
    }
    private final Kernel kernel;
    private final Auth auth;
    private final Semaphore requests=new Semaphore(64);
    private final Semaphore analyses=new Semaphore(2);
    private final AtomicLong completed=new AtomicLong(),rejected=new AtomicLong();
    public ApiRouter(Kernel kernel,Auth auth) {
        this.kernel=kernel;
        this.auth=auth;
    }
    public Response handle(String method,String path,Map<String,String> headers,byte[] body) {
        String requestId=UUID.randomUUID().toString();
        if(!requests.tryAcquire()) {
            rejected.incrementAndGet();
            return response(503,requestId,obj("error",obj("code","BUSY","message","Request capacity reached")));
        }
        boolean analysis=false;
        try {
            if(method.equals("GET")&&path.equals("/health"))return response(200,requestId,obj("status","UP"));
            if(headers.containsKey("origin"))throw new Problem(403,"ORIGIN_REJECTED","Browser-origin requests are disabled; use the authenticated SDK or stdio MCP bridge");
            Auth.Principal principal=auth.authenticate(headers.get("authorization"));
            if(!method.equals("POST"))throw new Problem(405,"METHOD_NOT_ALLOWED","Use POST for RPC operations");
            if(body.length>MAX_BODY)throw new Problem(413,"BODY_TOO_LARGE","Request body exceeds eight megabytes");
            if(!headers.getOrDefault("content-type","").toLowerCase(Locale.ROOT).startsWith("application/json"))throw new Problem(415,"CONTENT_TYPE","application/json is required");
            String[] parts=path.split("/");
            if(parts.length!=4||!parts[1].equals("v1")||!parts[3].matches("[a-z]+\\.[a-z]+"))throw Problem.missing("Unknown API path");
            String operation=parts[3];
            analysis=Set.of("models.check","traces.check","analysis.java").contains(operation);
            if(analysis&&!analyses.tryAcquire()) {
                analysis=false;
                throw new Problem(503,"ANALYZER_BUSY","Analysis capacity reached");
            }
            Map<String,Object> result=kernel.call(principal,parts[2],operation,map(parse(new String(body,StandardCharsets.UTF_8))),headers.get("idempotency-key"));
            completed.incrementAndGet();
            return response(200,requestId,result);
        }
        catch(Problem p) {
            rejected.incrementAndGet();
            return response(p.status,requestId,obj("error",obj("code",p.code,"message",p.getMessage(),"requestId",requestId)));
        }
        catch(ArithmeticException e) {
            return response(400,requestId,obj("error",obj("code","ARITHMETIC_RANGE","message","Model arithmetic exceeded its supported range")));
        }
        catch(Exception e) {
            System.err.println("assurance request="+requestId+" failure="+e.getClass().getSimpleName());
            return response(500,requestId,obj("error",obj("code","INTERNAL","message","Internal operation failed","requestId",requestId)));
        }
        finally {
            if(analysis)analyses.release();
            requests.release();
        }
    }
    private static Response response(int status,String id,Map<String,Object> body) {
        return new Response(status,Map.of("Content-Type","application/json; charset=utf-8","Cache-Control","no-store","X-Content-Type-Options","nosniff","X-Request-Id",id),write(body).getBytes(StandardCharsets.UTF_8));
    }
    public Map<String,Object> metrics() {
        return obj("completedRequests",completed.get(),"rejectedRequests",rejected.get(),"availableRequestSlots",requests.availablePermits());
    }
}
