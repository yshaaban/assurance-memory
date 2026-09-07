package dev.assurance.server;
import dev.assurance.core.ApiRouter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.*;
@RestController public final class AssuranceController {
    private final ApiRouter router;
    public AssuranceController(ApiRouter router) {
        this.router=router;
    }
    @RequestMapping({
        "/v1/**","/health"
    }) public ResponseEntity<byte[]> rpc(HttpServletRequest request)throws IOException {
        Map<String,String> headers=new HashMap<>();
        for(String name:List.of("Authorization","Content-Type","Idempotency-Key","Origin")) {
            String value=request.getHeader(name);
            if(value!=null)headers.put(name.toLowerCase(Locale.ROOT),value);
        }
        byte[] body=request.getInputStream().readNBytes(ApiRouter.MAX_BODY+1);
        ApiRouter.Response response=router.handle(request.getMethod(),request.getRequestURI(),headers,body);
        HttpHeaders output=new HttpHeaders();
        response.headers().forEach(output::set);
        return new ResponseEntity<>(response.body(),output,HttpStatusCode.valueOf(response.status()));
    }
}
