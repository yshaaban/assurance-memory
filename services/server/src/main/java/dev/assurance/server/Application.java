package dev.assurance.server;
import dev.assurance.core.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import javax.sql.DataSource;
import java.nio.file.*;
import java.time.Clock;
import java.util.Set;
@SpringBootApplication @EnableScheduling public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class,args);
    }
    @Bean JdbcStore store(DataSource source) {
        JdbcStore store=new JdbcStore(source);
        store.migrate();
        return store;
    }
    @Bean Auth auth()throws Exception {
        String path=System.getenv("ASSURANCE_AUTH_FILE");
        if(path==null||path.isBlank())throw new IllegalStateException("ASSURANCE_AUTH_FILE is required; production has no default credentials");
        return new Auth(Files.readString(Path.of(path)));
    }
    @Bean Kernel kernel(JdbcStore store) {
        return new Kernel(store,Clock.systemUTC());
    }
    @Bean ApiRouter router(Kernel kernel,Auth auth) {
        return new ApiRouter(kernel,auth);
    }
    @Component static class Maintenance {
        private final JdbcStore store;
        Maintenance(JdbcStore store) {
            this.store=store;
        }
        @Scheduled(fixedDelayString="${assurance.maintenance-delay-ms:60000}") public void sweep() {
            for(Store.Space space:store.spaces())try {
                store.write(space,tx->Kernel.maintenance(new Kernel.Ctx(tx,new Auth.Principal("maintenance",space.tenant(),Set.of(Auth.Role.MAINTAINER),Set.of(space.workspace()),Set.of()),System.currentTimeMillis())));
            }
            catch(Exception e) {
                System.err.println("assurance maintenance failure="+e.getClass().getSimpleName());
            }
        }
    }
}
