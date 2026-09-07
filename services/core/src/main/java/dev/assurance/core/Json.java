package dev.assurance.core;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
/** Small strict JSON codec shared by the offline harness and JDBC adapter; no polymorphic deserialization.
* Canonicalization is private to this service, not RFC 8785. Clients must use server-returned digests. */
public final class Json {
    private Json() {
    }
    public static Map<String,Object> obj(Object... kv) {
        if(kv.length%2!=0) throw new IllegalArgumentException("odd map arguments");
        Map<String,Object> m=new LinkedHashMap<>();
        for(int i=0; i<kv.length; i+=2) m.put((String)kv[i],kv[i+1]);
        return m;
    }
    @SuppressWarnings("unchecked") public static Map<String,Object> map(Object o) {
        if(!(o instanceof Map<?,?> m) || m.keySet().stream().anyMatch(k->!(k instanceof String))) throw Problem.bad("Expected object");
        return (Map<String,Object>)o;
    }
    @SuppressWarnings("unchecked") public static List<Object> list(Object o) {
        if(!(o instanceof List<?>)) throw Problem.bad("Expected array");
        return (List<Object>)o;
    }
    public static List<Object> list(Map<String,Object> m,String k) {
        return m.containsKey(k)?list(m.get(k)):List.of();
    }
    public static List<String> strings(Map<String,Object> m,String k) {
        return list(m,k).stream().map(x-> {
            if(!(x instanceof String s))throw Problem.bad(k+" must contain strings");
            return s;
        }).toList();
    }
    public static String str(Map<String,Object> m,String k) {
        Object v=m.get(k);
        if(!(v instanceof String s) || s.isBlank()) throw Problem.bad(k+" must be a nonempty string");
        return s;
    }
    public static String str(Map<String,Object> m,String k,String fallback) {
        if(!m.containsKey(k))return fallback;
        if(!(m.get(k) instanceof String s))throw Problem.bad(k+" must be a string");
        return s;
    }
    public static long num(Map<String,Object> m,String k,long fallback) {
        Object v=m.get(k);
        if(v==null)return fallback;
        if(!(v instanceof Number n)||!Double.isFinite(n.doubleValue())||n.doubleValue()!=n.longValue())throw Problem.bad(k+" must be an integer");
        return n.longValue();
    }
    public static boolean bool(Map<String,Object> m,String k,boolean fallback) {
        if(!m.containsKey(k))return fallback;
        if(!(m.get(k) instanceof Boolean b))throw Problem.bad(k+" must be boolean");
        return b;
    }
    public static Map<String,Object> child(Map<String,Object> m,String k) {
        return m.containsKey(k)?map(m.get(k)):obj();
    }
    public static String id(Map<String,Object> m,String k) {
        String s=str(m,k);
        Problem.require(s.matches("[A-Za-z0-9][A-Za-z0-9_.@/-]{0,119}"),k+" has an invalid identifier");
        return s;
    }
    public static String text(Map<String,Object> m,String k,int max) {
        String s=str(m,k);
        Problem.require(s.length()<=max,k+" is too long");
        return s;
    }
    public static Object parse(String s) {
        return new Parser(s).parse();
    }
    public static String write(Object o) {
        StringBuilder b=new StringBuilder();
        encode(o,b,0);
        return b.toString();
    }
    public static Map<String,Object> copy(Map<String,Object> m) {
        return map(parse(write(m)));
    }
    public static String hash(Object o) {
        return sha(write(o));
    }
    public static String sha(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        }
        catch(Exception e) {
            throw new IllegalStateException(e);
        }
    }
    private static void encode(Object o,StringBuilder b,int depth) {
        if(depth>64)throw Problem.bad("JSON nesting limit exceeded");
        if(o==null) {
            b.append("null");
            return;
        }
        if(o instanceof String s) {
            quote(s,b);
            return;
        }
        if(o instanceof Boolean) {
            b.append(o);
            return;
        }
        if(o instanceof Number n) {
            if(!Double.isFinite(n.doubleValue()))throw Problem.bad("Nonfinite JSON number");
            b.append(n);
            return;
        }
        if(o instanceof Map<?,?> m) {
            b.append('{');
            boolean first=true;
            List<String> keys=m.keySet().stream().map(k-> {
                if(!(k instanceof String))throw Problem.bad("Non-string key");
                return (String)k;
            }).sorted().toList();
            for(String k:keys) {
                if(!first)b.append(',');
                first=false;
                quote(k,b);
                b.append(':');
                encode(m.get(k),b,depth+1);
            }
            b.append('}');
            return;
        }
        if(o instanceof Collection<?> a) {
            b.append('[');
            boolean first=true;
            for(Object x:a) {
                if(!first)b.append(',');
                first=false;
                encode(x,b,depth+1);
            }
            b.append(']');
            return;
        }
        throw Problem.bad("Unsupported JSON value");
    }
    private static void quote(String s,StringBuilder b) {
        b.append('"');
        for(int i=0; i<s.length(); i++) {
            char c=s.charAt(i);
            switch(c) {
                case '"'->b.append("\\\"");
                case '\\'->b.append("\\\\");
                case '\n'->b.append("\\n");
                case '\r'->b.append("\\r");
                case '\t'->b.append("\\t");
                default-> {
                    if(c<32||Character.isSurrogate(c))b.append(String.format("\\u%04x",(int)c));
                    else b.append(c);
                }
            }
        }
        b.append('"');
    }
    private static final class Parser {
        private final String s;
        private int p;
        Parser(String s) {
            if(s==null||s.length()>8_000_000)throw Problem.bad("JSON body size exceeded");
            this.s=s;
        }
        Object parse() {
            Object v=value(0);
            space();
            if(p!=s.length())throw Problem.bad("Trailing JSON content");
            return v;
        }
        private Object value(int d) {
            if(d>64)throw Problem.bad("JSON nesting limit exceeded");
            space();
            if(p>=s.length())throw Problem.bad("Unexpected JSON end");
            char c=s.charAt(p);
            if(c=='"')return string();
            if(c=='{') {
                p++;
                Map<String,Object> m=obj();
                space();
                if(take('}'))return m;
                do {
                    space();
                    if(p>=s.length()||s.charAt(p)!='"')throw Problem.bad("Expected JSON key");
                    String k=string();
                    space();
                    need(':');
                    if(m.containsKey(k))throw Problem.bad("Duplicate JSON key");
                    m.put(k,value(d+1));
                    space();
                    if(take('}'))return m;
                    need(',');
                }
                while(true);
            }
            if(c=='[') {
                p++;
                List<Object>a=new ArrayList<>();
                space();
                if(take(']'))return a;
                do {
                    a.add(value(d+1));
                    if(a.size()>100_000)throw Problem.bad("JSON array limit exceeded");
                    space();
                    if(take(']'))return a;
                    need(',');
                }
                while(true);
            }
            if(s.startsWith("true",p)) {
                p+=4;
                return true;
            }
            if(s.startsWith("false",p)) {
                p+=5;
                return false;
            }
            if(s.startsWith("null",p)) {
                p+=4;
                return null;
            }
            return number();
        }
        private Number number() {
            int start=p;
            if(take('-')&&p>=s.length())throw Problem.bad("Bad number");
            if(take('0')) {
            }
            else {
                if(p>=s.length()||s.charAt(p)<'1'||s.charAt(p)>'9')throw Problem.bad("Bad number");
                while(p<s.length()&&Character.isDigit(s.charAt(p)))p++;
            }
            boolean decimal=false;
            if(take('.')) {
                decimal=true;
                digits();
            }
            if(p<s.length()&&(s.charAt(p)=='e'||s.charAt(p)=='E')) {
                decimal=true;
                p++;
                if(p<s.length()&&(s.charAt(p)=='+'||s.charAt(p)=='-'))p++;
                digits();
            }
            try {
                String n=s.substring(start,p);
                if(decimal) {
                    double v=Double.parseDouble(n);
                    if(!Double.isFinite(v))throw Problem.bad("Number out of range");
                    return v;
                }
                return Long.parseLong(n);
            }
            catch(NumberFormatException e) {
                throw Problem.bad("Number out of range");
            }
        }
        private void digits() {
            int start=p;
            while(p<s.length()&&Character.isDigit(s.charAt(p)))p++;
            if(p==start)throw Problem.bad("Bad number");
        }
        private String string() {
            need('"');
            StringBuilder b=new StringBuilder();
            while(p<s.length()) {
                char c=s.charAt(p++);
                if(c=='"')return b.toString();
                if(c<32)throw Problem.bad("Unescaped control character");
                if(c=='\\') {
                    if(p>=s.length())throw Problem.bad("Bad escape");
                    char e=s.charAt(p++);
                    switch(e) {
                        case '"','\\','/'->b.append(e);
                        case 'b'->b.append('\b');
                        case 'f'->b.append('\f');
                        case 'n'->b.append('\n');
                        case 'r'->b.append('\r');
                        case 't'->b.append('\t');
                        case 'u'-> {
                            if(p+4>s.length())throw Problem.bad("Bad unicode escape");
                            try {
                                b.append((char)Integer.parseInt(s.substring(p,p+4),16));
                            }
                            catch(NumberFormatException x) {
                                throw Problem.bad("Bad unicode escape");
                            }
                            p+=4;
                        }
                        default->throw Problem.bad("Bad escape");
                    }
                }
                else b.append(c);
            }
            throw Problem.bad("Unterminated string");
        }
        private void space() {
            while(p<s.length()&&" \n\r\t".indexOf(s.charAt(p))>=0)p++;
        }
        private boolean take(char c) {
            if(p<s.length()&&s.charAt(p)==c) {
                p++;
                return true;
            }
            return false;
        }
        private void need(char c) {
            if(!take(c))throw Problem.bad("Malformed JSON");
        }
    }
}
