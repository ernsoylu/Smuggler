package com.smuggler.desktop.ui;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.GlobalStats;
import javafx.animation.KeyFrame;
import javafx.animation.Timeline;
import javafx.application.Platform;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import javafx.util.Duration;
import org.kordamp.ikonli.feather.Feather;

/**
 * Bottom-of-window status bar: live global stats (dl/ul/active/mules/disk) +
 * mini rolling speed graph. Polls /api/stats/ every 2 s.
 */
public final class StatusFooter {

    private final ApiClient api;
    private final VBox root = new VBox();
    private final SpeedGraph graph = new SpeedGraph();
    private final Label dlLabel = mono();
    private final Label ulLabel = mono();
    private final Label activeLabel = mono();
    private final Label queuedLabel = mono();
    private final Label stoppedLabel = mono();
    private final Label mulesLabel = mono();
    private final Label diskLabel = mono();
    private final HBox diskCluster;
    private final Timeline timer;
    private final Region connDot = new Region();
    private final Label connLabel = new Label("Connecting…");
    private volatile boolean connected = false;

    public StatusFooter(ApiClient api) {
        this.api = api;

        HBox bar = new HBox(28);
        bar.setAlignment(Pos.CENTER_LEFT);
        bar.getStyleClass().add("stats-bar");
        bar.setStyle("-fx-background-radius: 0; -fx-border-radius: 0; -fx-border-width: 1 0 0 0;");

        // Download
        bar.getChildren().add(iconCol(Feather.ARROW_DOWN, "stat-icon-emerald", "icon-emerald", "DOWNLOAD", dlLabel, "emerald"));
        // Upload
        bar.getChildren().add(iconCol(Feather.ARROW_UP, "stat-icon-blue", "icon-blue", "UPLOAD", ulLabel, "blue"));

        bar.getChildren().add(separator());

        bar.getChildren().add(miniStat("ACTIVE", activeLabel, "emerald"));
        bar.getChildren().add(miniStat("QUEUED", queuedLabel, "orange"));
        bar.getChildren().add(miniStat("STOPPED", stoppedLabel, "neutral"));

        bar.getChildren().add(separator());

        bar.getChildren().add(iconCol(Feather.SERVER, "stat-icon-indigo", "icon-indigo", "MULES", mulesLabel, "neutral"));

        diskCluster = iconCol(Feather.HARD_DRIVE, "stat-icon-amber", "icon-amber", "DISK FREE", diskLabel, "neutral");
        diskCluster.setVisible(false);
        diskCluster.setManaged(false);
        bar.getChildren().add(separator());
        bar.getChildren().add(diskCluster);

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);
        bar.getChildren().add(spacer);

        // Mini chart on right side (~280px wide)
        StackPane chartWrap = new StackPane(graph.node());
        chartWrap.setMinWidth(260);
        chartWrap.setPrefWidth(280);
        chartWrap.setMaxWidth(320);
        chartWrap.setMinHeight(54);
        chartWrap.setPrefHeight(54);
        chartWrap.setMaxHeight(54);
        graph.node().setPrefHeight(54);
        graph.node().setMinHeight(54);
        graph.node().setMaxHeight(54);
        bar.getChildren().add(chartWrap);

        // Connection indicator — far right
        bar.getChildren().add(separator());
        bar.getChildren().add(buildConnectionIndicator());

        root.getStyleClass().add("footer");
        root.getChildren().add(bar);
        root.setMinHeight(74);

        timer = new Timeline(new KeyFrame(Duration.seconds(2), e -> refresh()));
        timer.setCycleCount(Timeline.INDEFINITE);
        timer.play();
        refresh();
    }

    public void stop() {
        if (timer != null) timer.stop();
    }

    private HBox buildConnectionIndicator() {
        connDot.setPrefSize(10, 10);
        connDot.setMinSize(10, 10);
        connDot.setMaxSize(10, 10);
        applyDotStyle(false);
        connLabel.getStyleClass().add("stat-value");
        VBox col = new VBox(2, smallLabel("API"), connLabel);
        col.setAlignment(Pos.CENTER_LEFT);
        HBox h = new HBox(10, connDot, col);
        h.setAlignment(Pos.CENTER_LEFT);
        return h;
    }

    private void applyDotStyle(boolean ok) {
        String color = ok ? "#10b981" : "#ef4444";
        String glow = ok ? "rgba(16,185,129,0.55)" : "rgba(239,68,68,0.55)";
        connDot.setStyle(
            "-fx-background-color: " + color + ";"
            + " -fx-background-radius: 999;"
            + " -fx-effect: dropshadow(gaussian, " + glow + ", 6, 0.6, 0, 0);"
        );
    }

    public Node node() { return root; }

    private void refresh() {
        api.ping().whenComplete((ok, pErr) -> {
            boolean alive = pErr == null && Boolean.TRUE.equals(ok);
            Platform.runLater(() -> setConnected(alive));
        });
        api.getStats().whenComplete((stats, err) -> {
            if (err != null || stats == null) return;
            Platform.runLater(() -> apply(stats));
        });
    }

    private void setConnected(boolean ok) {
        if (ok == connected && !connLabel.getText().equals("Connecting…")) return;
        connected = ok;
        applyDotStyle(ok);
        connLabel.setText(ok ? "Connected" : "Disconnected");
        connLabel.setStyle("-fx-text-fill: " + (ok ? "#34d399" : "#fca5a5") + ";");
    }

    private void apply(GlobalStats s) {
        dlLabel.setText(Format.speed(s.downloadSpeed()));
        ulLabel.setText(Format.speed(s.uploadSpeed()));
        activeLabel.setText(String.valueOf(s.numActive()));
        queuedLabel.setText(String.valueOf(s.numWaiting()));
        stoppedLabel.setText(String.valueOf(s.numStopped()));
        mulesLabel.setText(s.numMules() + "  active");
        if (s.diskFree() != null && s.diskTotal() != null) {
            diskLabel.setText(Format.bytesShort(s.diskFree()) + "  /  " + Format.bytesShort(s.diskTotal()));
            diskCluster.setVisible(true);
            diskCluster.setManaged(true);
        } else {
            diskCluster.setVisible(false);
            diskCluster.setManaged(false);
        }
        graph.push(s.downloadSpeed(), s.uploadSpeed());
    }

    // ── Builders ────────────────────────────────────────────────────────────

    private static Label mono() {
        Label l = new Label("—");
        l.getStyleClass().add("stat-value");
        return l;
    }

    private static Label smallLabel(String t) {
        Label l = new Label(t);
        l.getStyleClass().add("uppercase-label");
        return l;
    }

    private static Region separator() {
        Region r = new Region();
        r.setPrefWidth(1);
        r.setMinWidth(1);
        r.setMaxWidth(1);
        r.setPrefHeight(30);
        r.setStyle("-fx-background-color: rgba(255,255,255,0.06);");
        return r;
    }

    private static HBox iconCol(org.kordamp.ikonli.feather.Feather icon, String bgClass, String iconClass,
                                String title, Label valueLabel, String valueColor) {
        StackPane ic = new StackPane(Icons.of(icon, 16, iconClass));
        ic.getStyleClass().addAll("stat-icon", bgClass);
        VBox col = new VBox(2, smallLabel(title), valueLabel);
        valueLabel.getStyleClass().add(valueColor);
        HBox h = new HBox(10, ic, col);
        h.setAlignment(Pos.CENTER_LEFT);
        return h;
    }

    private static VBox miniStat(String title, Label valueLabel, String valueColor) {
        valueLabel.getStyleClass().add(valueColor);
        VBox col = new VBox(2, smallLabel(title), valueLabel);
        col.setAlignment(Pos.CENTER_LEFT);
        return col;
    }
}
