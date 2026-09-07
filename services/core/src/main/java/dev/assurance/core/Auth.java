package dev.assurance.core;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
/** Static service-account authentication for the reference deployment. Token hashes only are stored by the server.
* The tenant and actor come exclusively from the authenticated principal, never from a caller-supplied header.
* Put this service behind TLS. Use independently rotated accounts; never give agents runner/reviewer credentials. */
public final class Auth {
    public enum Role {
        READER, AGENT, SCANNER, RUNNER, MAINTAINER
    }
    public record Principal(String id,String tenant,Set<Role> roles,Set<String> workspaces,Set<String> checkers) {
        public void allow(Role... required) {
            if(Arrays.stream(required).noneMatch(roles::contains))throw new Problem(403,"FORBIDDEN","Role is not permitted for this operation");
        }
        public void workspace(String workspace) {
            if(!workspaces.contains(workspace)&&!workspaces.contains("*"))throw new Problem(403,"FORBIDDEN","Workspace is not permitted");
        }
    }
    private record Credential(byte[] digest,Principal principal) {
    }
    private final List<Credential> credentials;
    public Auth(String configuration) {
        credentials=new ArrayList<>();
        Set<String> identities=new HashSet<>();
        Set<String> hashes=new HashSet<>();
        for(Object raw:Json.list(Json.parse(configuration))) {
            Map<String,Object> m=Json.map(raw);
            String digest=Json.str(m,"tokenSha256");
            Problem.require(digest.matches("[a-f0-9]{64}"),"tokenSha256 must be a SHA-256 hex digest");
            Set<Role> roles=new HashSet<>();
            for(String r:Json.strings(m,"roles")) {
                try {
                    roles.add(Role.valueOf(r));
                }
                catch(IllegalArgumentException e) {
                    throw Problem.bad("Unknown role");
                }
            }
            Problem.require(roles.stream().filter(r->r!=Role.READER).count()<=1,"Use independent agent, scanner, runner and maintainer credentials");
            String id=Json.id(m,"id"),tenant=Json.id(m,"tenant");
            Problem.require(tenant.length()<=80,"Tenant identifier too long");
            Problem.require(identities.add(tenant+":"+id)&&hashes.add(digest),"Duplicate principal or token");
            Set<String> workspaces=Set.copyOf(Json.strings(m,"workspaces"));
            Problem.require(!workspaces.isEmpty()&&!roles.isEmpty(),"Empty authorization grant");
            credentials.add(new Credential(HexFormat.of().parseHex(digest),new Principal(id,tenant,Set.copyOf(roles),workspaces,Set.copyOf(Json.strings(m,"checkers")))));
        }
        Problem.require(!credentials.isEmpty(),"Authentication configuration cannot be empty");
    }
    public Principal authenticate(String header) {
        if(header==null||!header.startsWith("Bearer ")||header.length()>1024)throw new Problem(401,"UNAUTHENTICATED","Bearer token required");
        byte[] actual;
        try {
            actual=MessageDigest.getInstance("SHA-256").digest(header.substring(7).getBytes(StandardCharsets.UTF_8));
        }
        catch(Exception e) {
            throw new IllegalStateException(e);
        }
        Principal match=null;
        for(Credential c:credentials)if(MessageDigest.isEqual(c.digest,actual))match=c.principal;
        if(match==null)throw new Problem(401,"UNAUTHENTICATED","Invalid credential");
        return match;
    }
}
