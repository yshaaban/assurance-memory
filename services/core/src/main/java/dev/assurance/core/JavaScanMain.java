package dev.assurance.core;
import java.nio.charset.StandardCharsets;
/** Local scanner: stdin JSON, stdout JSON. Classpath attribution is permitted only in this explicit local entry point. */ public final class JavaScanMain {
    public static void main(String[] args)throws Exception {
        byte[] input=System.in.readNBytes(ApiRouter.MAX_BODY+1);
        if(input.length>ApiRouter.MAX_BODY)throw Problem.bad("Input too large");
        System.out.println(Json.write(new JavaAnalyzer(true).analyze(Json.map(Json.parse(new String(input,StandardCharsets.UTF_8))))));
    }
}
