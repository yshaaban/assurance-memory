package dev.assurance.core;
/** A safe, typed API failure. Messages must never contain credentials or source text. */ public final class Problem extends RuntimeException {
    public final int status;
    public final String code;
    public Problem(int status, String code, String message) {
        super(message);
        this.status=status;
        this.code=code;
    }
    public static Problem bad(String message) {
        return new Problem(400,"INVALID_INPUT",message);
    }
    public static Problem conflict(String message) {
        return new Problem(409,"CONFLICT",message);
    }
    public static Problem missing(String message) {
        return new Problem(404,"NOT_FOUND",message);
    }
    public static void require(boolean condition, String message) {
        if (!condition) throw bad(message);
    }
}
