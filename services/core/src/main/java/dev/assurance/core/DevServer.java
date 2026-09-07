package dev.assurance.core;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.time.Clock;
import java.util.*;
import java.util.concurrent.Executors;
import static dev.assurance.core.Json.*;
/** Dependency-free, loopback-only, IN-MEMORY demo harness. The production adapter is Spring Boot + PostgreSQL. */ public final class DevServer {
    public static void main(String[] args)throws Exception {
        int port=args.length>0?Integer.parseInt(args[0]):8080;
        String config=System.getenv("ASSURANCE_AUTH_FILE");
        Auth auth=new Auth(config==null?demoAuth():Files.readString(Path.of(config)));
        ApiRouter router=new ApiRouter(new Kernel(new MemoryStore(),Clock.systemUTC()),auth);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",port),64);
        server.createContext("/",exchange-> {
            Map<String,String> headers=new HashMap<>();
            exchange.getRequestHeaders().forEach((k,v)-> {
                if(!v.isEmpty())headers.put(k.toLowerCase(Locale.ROOT),v.getFirst());
            });
            byte[] request=exchange.getRequestBody().readNBytes(ApiRouter.MAX_BODY+1);
            ApiRouter.Response response=router.handle(exchange.getRequestMethod(),exchange.getRequestURI().getPath(),headers,request);
            response.headers().forEach((k,v)->exchange.getResponseHeaders().set(k,v));
            exchange.sendResponseHeaders(response.status(),response.body().length);
            try(var output=exchange.getResponseBody()) {
                output.write(response.body());
            }
        });
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        Runtime.getRuntime().addShutdownHook(new Thread(()->server.stop(1)));
        server.start();
        System.err.println("IN-MEMORY DEMO ONLY: http://127.0.0.1:"+port+" (data disappears on exit)");
    }
    public static String demoAuth() {
        List<Object> principals=new ArrayList<>();
        for(String role:List.of("reader","agent","scanner","runner","maintainer"))principals.add(obj("id",role,"tenant","demo","tokenSha256",sha("demo-"+role+"-token"),"roles",List.of(role.toUpperCase(Locale.ROOT)),"workspaces",List.of("demo"),"checkers",role.equals("runner")?List.of("unit-tests","protocol-model","release-gate","static-check","benchmark"):List.of()));
        return write(principals);
    }
}
