package com.smuggler.desktop.api;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.smuggler.desktop.api.dto.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpRequest.BodyPublisher;
import java.net.http.HttpRequest.BodyPublishers;
import java.net.http.HttpResponse;
import java.net.http.HttpResponse.BodyHandlers;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Flask REST API client. Mirrors web/src/api/client.ts. All methods are async
 * and return CompletableFutures so the JavaFX thread never blocks.
 */
public final class ApiClient {

    private static final Logger log = LoggerFactory.getLogger(ApiClient.class);
    // Matches the Docker API container (gunicorn binds 0.0.0.0:55555 with
    // network_mode: host). Same port is used by `./start.sh debug` (Flask dev
    // server) and `smg web` / `smg client`. Override with SMG_API_URL.
    private static final String DEFAULT_BASE = "http://127.0.0.1:55555";

    private final String baseUrl;
    private final HttpClient http;
    private final ObjectMapper json;

    public ApiClient() {
        this(System.getenv().getOrDefault("SMG_API_URL", DEFAULT_BASE));
    }

    public ApiClient(String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
        this.json = new ObjectMapper()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    public String baseUrl() { return baseUrl; }

    // ── Health ────────────────────────────────────────────────────────────────

    public CompletableFuture<Boolean> ping() {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/health/"))
            .timeout(Duration.ofSeconds(3))
            .GET()
            .build();
        return http.sendAsync(req, BodyHandlers.discarding())
            .thenApply(r -> r.statusCode() >= 200 && r.statusCode() < 300)
            .exceptionally(ex -> false);
    }

    // ── Mules ─────────────────────────────────────────────────────────────────

    public CompletableFuture<List<Mule>> getMules() {
        return getList("/api/mules/", new TypeReference<>() {});
    }

    public CompletableFuture<Void> stopMule(String name) {
        return delete("/api/mules/" + encode(name));
    }

    public CompletableFuture<Void> killMule(String name) {
        return postJson("/api/mules/" + encode(name) + "/kill", "{}", Void.class).thenApply(x -> null);
    }

    public CompletableFuture<IpInfo> getMuleIp(String name) {
        return getJson("/api/mules/" + encode(name) + "/ip", IpInfo.class);
    }

    // ── Torrents ──────────────────────────────────────────────────────────────

    public CompletableFuture<List<Torrent>> getAllTorrents() {
        return getList("/api/torrents/", new TypeReference<>() {});
    }

    public CompletableFuture<Map<String, Object>> addMagnet(String mule, String magnet) {
        Map<String, Object> body = Map.of("magnet", magnet);
        try {
            return postJson("/api/torrents/" + encode(mule), json.writeValueAsString(body),
                new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return CompletableFuture.failedFuture(e);
        }
    }

    public CompletableFuture<Map<String, Object>> addTorrentFile(String mule, Path file) {
        try {
            Multipart mp = new Multipart();
            mp.addFile("torrent_file", file);
            return postMultipart("/api/torrents/" + encode(mule), mp,
                new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            return CompletableFuture.failedFuture(e);
        }
    }

    public CompletableFuture<Void> removeTorrent(String mule, String gid, boolean deleteFiles) {
        return delete("/api/torrents/" + encode(mule) + "/" + encode(gid)
            + "?delete_files=" + (deleteFiles ? "true" : "false"));
    }

    public CompletableFuture<Void> pauseTorrent(String mule, String gid) {
        return postJson("/api/torrents/" + encode(mule) + "/" + encode(gid) + "/pause",
            "{}", Void.class).thenApply(x -> null);
    }

    public CompletableFuture<Void> resumeTorrent(String mule, String gid) {
        return postJson("/api/torrents/" + encode(mule) + "/" + encode(gid) + "/resume",
            "{}", Void.class).thenApply(x -> null);
    }

    public CompletableFuture<List<Peer>> getTorrentPeers(String mule, String gid) {
        return getList("/api/torrents/" + encode(mule) + "/" + encode(gid) + "/peers",
            new TypeReference<>() {});
    }

    public CompletableFuture<TorrentOptions> getTorrentOptions(String mule, String gid) {
        return getJson("/api/torrents/" + encode(mule) + "/" + encode(gid) + "/options",
            TorrentOptions.class);
    }

    public CompletableFuture<Void> setTorrentOptions(String mule, String gid, Map<String, Object> opts) {
        try {
            return patchJson("/api/torrents/" + encode(mule) + "/" + encode(gid) + "/options",
                json.writeValueAsString(opts));
        } catch (Exception e) {
            return CompletableFuture.failedFuture(e);
        }
    }

    public CompletableFuture<Void> setFileSelection(String mule, String gid, List<Integer> indices) {
        try {
            String body = json.writeValueAsString(Map.of("selected_indices", indices));
            return patchJson("/api/torrents/" + encode(mule) + "/" + encode(gid) + "/files", body);
        } catch (Exception e) {
            return CompletableFuture.failedFuture(e);
        }
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    public CompletableFuture<GlobalStats> getStats() {
        return getJson("/api/stats/", GlobalStats.class);
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    public CompletableFuture<AppSettings> getSettings() {
        return getJson("/api/settings/", AppSettings.class);
    }

    public CompletableFuture<AppSettings> saveSettings(AppSettings settings) {
        try {
            String body = json.writeValueAsString(settings);
            return postJson("/api/settings/", body, new TypeReference<Map<String, Object>>() {})
                .thenApply(resp -> {
                    Object s = resp.get("settings");
                    return json.convertValue(s, AppSettings.class);
                });
        } catch (Exception e) {
            return CompletableFuture.failedFuture(e);
        }
    }

    // ── VPN Configs ───────────────────────────────────────────────────────────

    public CompletableFuture<List<VpnConfig>> getConfigs() {
        return getList("/api/configs/", new TypeReference<>() {});
    }

    public CompletableFuture<VpnConfig> uploadConfig(Path file, String name, String username, String password) {
        try {
            Multipart mp = new Multipart();
            mp.addFile("config_file", file);
            if (name != null && !name.isBlank()) mp.addField("name", name);
            if (username != null && !username.isBlank()) mp.addField("username", username);
            if (password != null && !password.isBlank()) mp.addField("password", password);
            return postMultipart("/api/configs/", mp, VpnConfig.class);
        } catch (Exception e) {
            return CompletableFuture.failedFuture(e);
        }
    }

    public CompletableFuture<Void> deleteConfig(long id) {
        return delete("/api/configs/" + id);
    }

    public CompletableFuture<Mule> deployMuleFromConfig(long configId, String name) {
        try {
            Map<String, Object> body = new HashMap<>();
            if (name != null && !name.isBlank()) body.put("name", name);
            return postJson("/api/configs/" + configId + "/deploy",
                json.writeValueAsString(body), Mule.class);
        } catch (Exception e) {
            return CompletableFuture.failedFuture(e);
        }
    }

    // ── Watchdog ──────────────────────────────────────────────────────────────

    public CompletableFuture<WatchdogStatus> getWatchdogStatus() {
        return getJson("/api/watchdog/", WatchdogStatus.class);
    }

    public CompletableFuture<Map<String, Object>> evacuateMule(String name, boolean kill) {
        return postJson("/api/mules/" + encode(name) + "/evacuate?kill=" + kill,
            "{}", new TypeReference<Map<String, Object>>() {});
    }

    public CompletableFuture<Map<String, Object>> triggerWatchdogSweep() {
        return postJson("/api/watchdog/run", "{}",
            new TypeReference<Map<String, Object>>() {});
    }

    // ── Low-level helpers ─────────────────────────────────────────────────────

    private <T> CompletableFuture<T> getJson(String path, Class<T> cls) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(10))
            .GET()
            .build();
        return http.sendAsync(req, BodyHandlers.ofString())
            .thenApply(r -> decode(r, cls));
    }

    private <T> CompletableFuture<List<T>> getList(String path, TypeReference<List<T>> ref) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(10))
            .GET()
            .build();
        return http.sendAsync(req, BodyHandlers.ofString())
            .thenApply(r -> decodeRef(r, ref));
    }

    private <T> CompletableFuture<T> postJson(String path, String body, Class<T> cls) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(60))
            .header("Content-Type", "application/json")
            .POST(BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build();
        return http.sendAsync(req, BodyHandlers.ofString())
            .thenApply(r -> cls == Void.class ? null : decode(r, cls));
    }

    private <T> CompletableFuture<T> postJson(String path, String body, TypeReference<T> ref) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(60))
            .header("Content-Type", "application/json")
            .POST(BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build();
        return http.sendAsync(req, BodyHandlers.ofString())
            .thenApply(r -> decodeRef(r, ref));
    }

    private CompletableFuture<Void> patchJson(String path, String body) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(15))
            .header("Content-Type", "application/json")
            .method("PATCH", BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build();
        return http.sendAsync(req, BodyHandlers.ofString())
            .thenApply(this::ensureOk)
            .thenApply(r -> null);
    }

    private CompletableFuture<Void> delete(String path) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(30))
            .DELETE()
            .build();
        return http.sendAsync(req, BodyHandlers.ofString())
            .thenApply(this::ensureOk)
            .thenApply(r -> null);
    }

    private <T> CompletableFuture<T> postMultipart(String path, Multipart mp, Class<T> cls) {
        BodyPublisher pub = mp.bodyPublisher();
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(60))
            .header("Content-Type", "multipart/form-data; boundary=" + mp.boundary)
            .POST(pub)
            .build();
        return http.sendAsync(req, BodyHandlers.ofString())
            .thenApply(r -> decode(r, cls));
    }

    private <T> CompletableFuture<T> postMultipart(String path, Multipart mp, TypeReference<T> ref) {
        BodyPublisher pub = mp.bodyPublisher();
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
            .timeout(Duration.ofSeconds(60))
            .header("Content-Type", "multipart/form-data; boundary=" + mp.boundary)
            .POST(pub)
            .build();
        return http.sendAsync(req, BodyHandlers.ofString())
            .thenApply(r -> decodeRef(r, ref));
    }

    private HttpResponse<String> ensureOk(HttpResponse<String> r) {
        if (r.statusCode() >= 400) {
            throw new ApiException(r.statusCode(), r.body());
        }
        return r;
    }

    private <T> T decode(HttpResponse<String> r, Class<T> cls) {
        ensureOk(r);
        try {
            if (r.body() == null || r.body().isEmpty()) return null;
            return json.readValue(r.body(), cls);
        } catch (IOException e) {
            log.error("JSON decode failed: {}", e.getMessage());
            throw new ApiException(r.statusCode(), "Invalid JSON: " + e.getMessage());
        }
    }

    private <T> T decodeRef(HttpResponse<String> r, TypeReference<T> ref) {
        ensureOk(r);
        try {
            if (r.body() == null || r.body().isEmpty()) return null;
            return json.readValue(r.body(), ref);
        } catch (IOException e) {
            log.error("JSON decode failed: {}", e.getMessage());
            throw new ApiException(r.statusCode(), "Invalid JSON: " + e.getMessage());
        }
    }

    private static String encode(String v) {
        return URLEncoder.encode(v, StandardCharsets.UTF_8);
    }

    // ── Multipart builder ─────────────────────────────────────────────────────

    private static final class Multipart {
        final String boundary = "----smuggler-" + UUID.randomUUID().toString().replace("-", "");
        private final List<byte[]> parts = new ArrayList<>();

        void addField(String name, String value) {
            StringBuilder sb = new StringBuilder();
            sb.append("--").append(boundary).append("\r\n");
            sb.append("Content-Disposition: form-data; name=\"").append(name).append("\"\r\n\r\n");
            sb.append(value).append("\r\n");
            parts.add(sb.toString().getBytes(StandardCharsets.UTF_8));
        }

        void addFile(String name, Path file) throws IOException {
            StringBuilder sb = new StringBuilder();
            sb.append("--").append(boundary).append("\r\n");
            sb.append("Content-Disposition: form-data; name=\"").append(name).append("\"; filename=\"")
                .append(file.getFileName()).append("\"\r\n");
            sb.append("Content-Type: application/octet-stream\r\n\r\n");
            parts.add(sb.toString().getBytes(StandardCharsets.UTF_8));
            parts.add(Files.readAllBytes(file));
            parts.add("\r\n".getBytes(StandardCharsets.UTF_8));
        }

        BodyPublisher bodyPublisher() {
            parts.add(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
            int total = parts.stream().mapToInt(b -> b.length).sum();
            byte[] buf = new byte[total];
            int off = 0;
            for (byte[] p : parts) {
                System.arraycopy(p, 0, buf, off, p.length);
                off += p.length;
            }
            return BodyPublishers.ofByteArray(buf);
        }
    }

    public static final class ApiException extends RuntimeException {
        private final int status;
        public ApiException(int status, String msg) {
            super("HTTP " + status + ": " + msg);
            this.status = status;
        }
        public int status() { return status; }
    }
}
