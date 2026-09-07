package dev.assurance.core;
import java.time.Clock;
import java.util.*;
import static dev.assurance.core.Json.*;
/** Synthetic semantic-index/invalidation exercise, NOT a PostgreSQL or parser throughput benchmark. */ public final class ScaleSelfTest {
    static Kernel kernel = new Kernel(new MemoryStore(), Clock.systemUTC());
    static Auth.Principal principal(Auth.Role role) {
        return new Auth.Principal(role.name(), "scale", Set.of(role), Set.of("test"), Set.of("static-check"));
    }
    static Map<String,Object> call(Auth.Role role, String operation, Map<String,Object> body) {
        return kernel.call(principal(role), "test", operation, body, UUID.randomUUID().toString());
    }
    static Map<String,Object> publish(String expected, List<Object> facts) {
        Map<String,Object> stage = call(Auth.Role.SCANNER, "scan.start", obj("component", "large", "expectedHead", expected, "sourceRevision", "a".repeat(40), "environment", obj(), "configurationDigest", sha("config"), "expectedFacts", facts.size(), "coverage", obj("discovery", "COMPLETE", "semantic", "RESOLVED", "limitations", List.of()), "analyzer", "synthetic/1", "rulesExecuted", List.of()));
        for (int i = 0; i < facts.size(); i += 500) call(Auth.Role.SCANNER, "scan.batch", obj("scanId", stage.get("id"), "facts", facts.subList(i, Math.min(i + 500, facts.size())), "findings", List.of()));
        return call(Auth.Role.SCANNER, "scan.commit", obj("scanId", stage.get("id")));
    }
    public static void main(String[] args) {
        int count = args.length == 0 ? 10000 : Integer.parseInt(args[0]);
        if (count < 100 || count > 50000) throw new IllegalArgumentException("100..50000 facts required");
        List<Object> facts = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            String locator = "file" + i + ".ts#function";
            facts.add(obj("id", sha("large:" + locator), "locator", locator, "path", "file" + i + ".ts", "language", "TS", "kind", "FUNCTION", "contentHash", sha("v1"), "signatureHash", sha("signature"), "tags", List.of("all", "scope-" + (i % 100)), "effects", List.of(), "metrics", obj(), "line", 1));
        }
        long start = System.nanoTime();
        Map<String,Object> first = publish("", facts);
        long initialMs = (System.nanoTime() - start) / 1_000_000;
        for (int i = 0; i < 100; i++) call(Auth.Role.MAINTAINER, "claims.approve", obj("id", "obligation-" + i, "expectedRevision", 0, "statement", "Synthetic scoped obligation", "owner", "scale-test", "components", List.of("large"), "watch", List.of("scope:large:scope-" + i), "quantification", "ALL_MATCHING", "mode", "DIRECT", "checks", List.of(obj("id", "check", "kind", "STATIC", "checker", "static-check", "version", "1"))));
        map(facts.get(7)).put("contentHash", sha("v2"));
        start = System.nanoTime();
        Map<String,Object> second = publish(str(child(first, "head"), "head"), facts);
        long changedMs = (System.nanoTime() - start) / 1_000_000;
        if (!write(second.get("impactedClaims")).equals(write(List.of("obligation-7")))) throw new AssertionError("Invalidation was not selective: " + second.get("impactedClaims"));
        System.out.println(write(obj("kind", "SYNTHETIC_MEMORY_STORE_ONLY", "facts", count, "claims", 100, "initialPublishMs", initialMs, "changedPublishMs", changedMs, "impactedClaims", second.get("impactedClaims"), "notice", "One local run including full staged publication; not a SQL, real-parser, p99, or production-capacity result")));
    }
}
