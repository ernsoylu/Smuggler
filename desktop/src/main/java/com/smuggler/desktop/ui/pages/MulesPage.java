package com.smuggler.desktop.ui.pages;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.Mule;
import com.smuggler.desktop.api.dto.MuleHealth;
import com.smuggler.desktop.api.dto.WatchdogStatus;
import com.smuggler.desktop.ui.AppShell;
import com.smuggler.desktop.ui.Icons;
import com.smuggler.desktop.ui.modals.DeployMuleModal;
import javafx.animation.KeyFrame;
import javafx.animation.Timeline;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.TilePane;
import javafx.scene.layout.VBox;
import javafx.util.Duration;
import org.kordamp.ikonli.feather.Feather;
import org.kordamp.ikonli.javafx.FontIcon;

import java.util.Collections;
import java.util.List;

public final class MulesPage implements AppShell.Page {

    private final ApiClient api;
    private final VBox root = new VBox(22);
    private final TilePane grid = new TilePane();
    private final Label emptyLabel = new Label("No mules are currently running. Click \"Deploy Mule\" to get started.");
    private final VBox watchdogHolder = new VBox();
    private final Label activeCount = new Label("0");
    private final Timeline muleTimer;
    private final Timeline watchdogTimer;

    private List<Mule> mules = Collections.emptyList();

    public MulesPage(ApiClient api) {
        this.api = api;
        root.getStyleClass().add("page-content");
        build();

        muleTimer = new Timeline(new KeyFrame(Duration.seconds(3), e -> refreshMules()));
        muleTimer.setCycleCount(Timeline.INDEFINITE);
        muleTimer.play();

        watchdogTimer = new Timeline(new KeyFrame(Duration.seconds(15), e -> refreshWatchdog()));
        watchdogTimer.setCycleCount(Timeline.INDEFINITE);
        watchdogTimer.play();

        refreshMules();
        refreshWatchdog();
    }

    @Override public Node node() { return root; }

    private void build() {
        Label title = new Label("Mules");
        title.getStyleClass().add("page-title");
        Label subtitle = new Label("Deploy and manage isolated VPN containers for secure proxying.");
        subtitle.getStyleClass().add("page-subtitle");
        VBox titleBlock = new VBox(4, title, subtitle);

        Button deploy = new Button("Deploy Mule", Icons.of(Feather.SEND, 16, "icon-white"));
        deploy.getStyleClass().addAll("button", "btn-primary");
        deploy.setOnAction(e -> new DeployMuleModal(api, this::refreshMules).show(root.getScene().getWindow()));

        Region sp = new Region();
        HBox.setHgrow(sp, Priority.ALWAYS);
        HBox header = new HBox(16, titleBlock, sp, deploy);
        header.setAlignment(Pos.CENTER_LEFT);

        Label sectionTitle = new Label("Active Deployments");
        sectionTitle.setStyle("-fx-text-fill: #fafafa; -fx-font-weight: bold; -fx-font-size: 16px;");
        Label badge = activeCount;
        badge.getStyleClass().add("badge-count");
        HBox sectionHeader = new HBox(10, sectionTitle, badge);
        sectionHeader.setAlignment(Pos.CENTER_LEFT);

        grid.setHgap(18);
        grid.setVgap(18);
        grid.setPrefTileWidth(300);
        grid.setPrefTileHeight(Region.USE_COMPUTED_SIZE);
        grid.setPadding(new Insets(0));

        emptyLabel.getStyleClass().addAll("empty-state", "muted");
        emptyLabel.setMaxWidth(Double.MAX_VALUE);
        emptyLabel.setAlignment(Pos.CENTER);
        emptyLabel.setPadding(new Insets(40));

        root.getChildren().addAll(header, watchdogHolder, sectionHeader, grid, emptyLabel);
    }

    private void refreshMules() {
        api.getMules().whenComplete((list, err) -> {
            if (err != null || list == null) return;
            Platform.runLater(() -> applyMules(list));
        });
    }

    private void refreshWatchdog() {
        api.getWatchdogStatus().whenComplete((st, err) -> {
            if (err != null || st == null) {
                Platform.runLater(() -> watchdogHolder.getChildren().clear());
                return;
            }
            Platform.runLater(() -> renderWatchdog(st));
        });
    }

    private void applyMules(List<Mule> list) {
        this.mules = list;
        grid.getChildren().clear();
        for (Mule m : list) {
            grid.getChildren().add(new MuleCard(api, m, this::refreshMules).node());
        }
        activeCount.setText(String.valueOf(list.size()));
        boolean empty = list.isEmpty();
        emptyLabel.setVisible(empty);
        emptyLabel.setManaged(empty);
        grid.setVisible(!empty);
        grid.setManaged(!empty);
    }

    private void renderWatchdog(WatchdogStatus st) {
        watchdogHolder.getChildren().clear();
        if (st.mules() == null || st.mules().isEmpty()) return;

        List<MuleHealth> unhealthy = st.mules().stream().filter(m -> !m.healthy()).toList();
        List<MuleHealth> healthy = st.mules().stream().filter(MuleHealth::healthy).toList();
        boolean allHealthy = unhealthy.isEmpty();

        VBox panel = new VBox(12);
        panel.getStyleClass().add(allHealthy ? "panel-emerald" : "panel-red");
        panel.setPadding(new Insets(18));

        FontIcon icon = Icons.of(allHealthy ? Feather.SHIELD : Feather.ALERT_TRIANGLE, 18,
            allHealthy ? "icon-emerald" : "icon-red");
        String titleText = allHealthy
            ? "All VPN connections secure"
            : unhealthy.size() + " mule" + (unhealthy.size() > 1 ? "s" : "") + " compromised";
        Label pTitle = new Label(titleText);
        pTitle.setStyle("-fx-font-weight: bold; -fx-font-size: 13px; -fx-text-fill: "
            + (allHealthy ? "#6ee7b7" : "#fca5a5") + ";");

        String lastRun = st.stats() != null && st.stats().lastRunAt() != null
            ? " · last check " + st.stats().lastRunAt()
            : "";
        long sweeps = st.stats() != null ? st.stats().totalSweeps() : 0;
        long evacs = st.stats() != null ? st.stats().totalEvacuations() : 0;
        int interval = st.config() != null ? st.config().intervalSeconds() : 0;
        Label pSub = new Label("Watchdog · interval " + interval + "s · "
            + sweeps + " sweeps · " + evacs + " evacuations" + lastRun);
        pSub.getStyleClass().add("muted-xs");

        VBox titles = new VBox(2, pTitle, pSub);
        Region hsp = new Region();
        HBox.setHgrow(hsp, Priority.ALWAYS);

        Button sweepBtn = new Button("Check now", Icons.of(Feather.REFRESH_CW, 13, "icon-muted"));
        sweepBtn.getStyleClass().addAll("button", "btn-ghost");
        sweepBtn.setOnAction(e -> {
            sweepBtn.setDisable(true);
            api.triggerWatchdogSweep().whenComplete((v, err) -> Platform.runLater(() -> {
                sweepBtn.setDisable(false);
                refreshWatchdog();
            }));
        });

        HBox hdr = new HBox(12, icon, titles, hsp, sweepBtn);
        hdr.setAlignment(Pos.CENTER_LEFT);
        panel.getChildren().add(hdr);

        if (!unhealthy.isEmpty()) {
            VBox rows = new VBox(8);
            for (MuleHealth m : unhealthy) {
                rows.getChildren().add(buildUnhealthyRow(m));
            }
            panel.getChildren().add(rows);
        }

        if (!healthy.isEmpty()) {
            FlowPane chips = new FlowPane(8, 8);
            for (MuleHealth m : healthy) {
                chips.getChildren().add(buildHealthyChip(m));
            }
            panel.getChildren().add(chips);
        }

        watchdogHolder.getChildren().add(panel);
    }

    private HBox buildUnhealthyRow(MuleHealth m) {
        FontIcon ic = Icons.of(Feather.SHIELD_OFF, 14, "icon-red");
        Label name = new Label(m.name());
        name.setStyle("-fx-text-fill: #fca5a5; -fx-font-weight: 600; -fx-font-size: 13px;");
        Label reason = new Label(m.reason() == null ? "" : m.reason());
        reason.setStyle("-fx-text-fill: rgba(248,113,113,0.7); -fx-font-size: 11px;");
        VBox texts = new VBox(2, name, reason);

        Region sp = new Region();
        HBox.setHgrow(sp, Priority.ALWAYS);
        HBox row = new HBox(10, ic, texts, sp);
        row.setAlignment(Pos.CENTER_LEFT);
        row.setStyle("-fx-background-color: rgba(239,68,68,0.10); -fx-background-radius: 10; -fx-border-color: rgba(239,68,68,0.2); -fx-border-radius: 10; -fx-border-width: 1; -fx-padding: 10 14 10 14;");

        if (Boolean.TRUE.equals(m.evacuated())) {
            Label ev = new Label("EVACUATED");
            ev.getStyleClass().addAll("status-pill", "status-removed");
            row.getChildren().add(ev);
        } else {
            Button evac = new Button("Evacuate", Icons.of(Feather.LOG_OUT, 12, "icon-red"));
            evac.getStyleClass().addAll("button", "btn-danger");
            evac.setOnAction(e -> {
                evac.setDisable(true);
                api.evacuateMule(m.name(), true).whenComplete((v, err) -> Platform.runLater(() -> {
                    refreshWatchdog();
                    refreshMules();
                }));
            });
            row.getChildren().add(evac);
        }
        return row;
    }

    private HBox buildHealthyChip(MuleHealth m) {
        FontIcon ic = Icons.of(Feather.SHIELD, 11, "icon-emerald");
        Label name = new Label(m.name());
        name.setStyle("-fx-text-fill: #34d399; -fx-font-family: monospace; -fx-font-size: 11px; -fx-font-weight: 500;");
        HBox h = new HBox(6, ic, name);
        if (m.ip() != null && !m.ip().isBlank()) {
            Label ip = new Label(m.ip());
            ip.setStyle("-fx-text-fill: rgba(16,185,129,0.6); -fx-font-family: monospace; -fx-font-size: 11px;");
            h.getChildren().add(ip);
        }
        h.setAlignment(Pos.CENTER_LEFT);
        h.setStyle("-fx-background-color: rgba(16,185,129,0.10); -fx-background-radius: 8; -fx-border-color: rgba(16,185,129,0.15); -fx-border-radius: 8; -fx-border-width: 1; -fx-padding: 4 10 4 10;");
        return h;
    }
}
