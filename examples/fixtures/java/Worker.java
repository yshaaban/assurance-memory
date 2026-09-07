package example;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import org.springframework.scheduling.annotation.Async;
import org.springframework.transaction.annotation.Transactional;

/** Deliberately unsafe input for the JDK/Spring analyzer. */
public class Worker {
    public void process() { finalizeJob(); dispatch(); }

    @Transactional
    public void finalizeJob() { System.out.println("proxy bypass on self invocation"); }

    @Async
    public void dispatch() { Executors.newCachedThreadPool().submit(() -> finalizeJob()); }

    public void cancel(CompletableFuture<?> work) { work.cancel(true); }

    public void await() {
        try { Thread.sleep(1000); }
        catch (InterruptedException ignored) { }
    }
}
