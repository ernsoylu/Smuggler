package com.smuggler.desktop.ui;

/** Formatting helpers that mirror the web UI's byte/speed/eta renderers. */
public final class Format {
    private Format() {}

    public static String bytes(long bytes) {
        if (bytes >= 1_073_741_824L) return String.format("%.2f GB", bytes / 1_073_741_824.0);
        if (bytes >= 1_048_576L)     return String.format("%.1f MB", bytes / 1_048_576.0);
        if (bytes >= 1_024L)         return String.format("%d KB",   bytes / 1_024);
        return bytes + " B";
    }

    public static String bytesShort(long bytes) {
        if (bytes >= 1_073_741_824L) return String.format("%.1f GB", bytes / 1_073_741_824.0);
        if (bytes >= 1_048_576L)     return String.format("%d MB",   bytes / 1_048_576L);
        if (bytes >= 1_024L)         return String.format("%d KB",   bytes / 1_024L);
        return bytes + " B";
    }

    public static String speed(long bps) {
        if (bps >= 1_048_576L) return String.format("%.1f MB/s", bps / 1_048_576.0);
        if (bps >= 1_024L)     return String.format("%d KB/s",  bps / 1_024L);
        return bps > 0 ? bps + " B/s" : "—";
    }

    public static String eta(long seconds) {
        if (seconds < 0) return "∞";
        if (seconds == 0) return "—";
        if (seconds < 60) return seconds + "s";
        if (seconds < 3600) return (seconds / 60) + "m " + (seconds % 60) + "s";
        long h = seconds / 3600;
        long m = (seconds % 3600) / 60;
        return h + "h " + m + "m";
    }

    public static String statusKey(String status) {
        if (status == null) return "removed";
        return switch (status) {
            case "active", "waiting", "paused", "error", "complete", "removed" -> status;
            default -> "removed";
        };
    }
}
