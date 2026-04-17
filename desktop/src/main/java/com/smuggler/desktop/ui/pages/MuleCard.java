package com.smuggler.desktop.ui.pages;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.IpInfo;
import com.smuggler.desktop.api.dto.Mule;
import com.smuggler.desktop.ui.Icons;
import com.smuggler.desktop.ui.modals.ConfirmModal;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import org.kordamp.ikonli.feather.Feather;

public final class MuleCard {

    private final ApiClient api;
    private final Mule mule;
    private final Runnable onChanged;
    private final VBox root = new VBox();

    public MuleCard(ApiClient api, Mule mule, Runnable onChanged) {
        this.api = api;
        this.mule = mule;
        this.onChanged = onChanged == null ? () -> {} : onChanged;
        build();
    }

    public Node node() { return root; }

    private void build() {
        root.getStyleClass().addAll("card", "card-hover");
        root.setSpacing(14);
        root.setPrefWidth(280);
        root.setMinWidth(260);
        root.setMaxWidth(340);

        boolean running = "running".equalsIgnoreCase(mule.status());

        // Header: status dot + name + status pill
        Region dot = new Region();
        dot.setPrefSize(10, 10);
        dot.setMinSize(10, 10);
        dot.setMaxSize(10, 10);
        dot.setStyle("-fx-background-color: " + (running ? "#10b981" : "#737373") + "; -fx-background-radius: 5;");

        Label name = new Label(mule.name());
        name.setStyle("-fx-text-fill: #fafafa; -fx-font-weight: bold; -fx-font-size: 14px;");

        Label id = new Label(mule.id() == null ? "" : mule.id().substring(0, Math.min(12, mule.id().length())));
        id.getStyleClass().addAll("muted-xs", "mono");

        VBox titleBox = new VBox(2, name, id);
        HBox nameRow = new HBox(10, dot, titleBox);
        nameRow.setAlignment(Pos.TOP_LEFT);

        Label statusPill = new Label(mule.status() == null ? "unknown" : mule.status().toUpperCase());
        statusPill.getStyleClass().addAll("status-pill", running ? "status-active" : "status-removed");

        Region hspacer = new Region();
        HBox.setHgrow(hspacer, Priority.ALWAYS);
        HBox header = new HBox(8, nameRow, hspacer, statusPill);
        header.setAlignment(Pos.TOP_LEFT);
        header.setPadding(new Insets(0, 0, 10, 0));
        header.setStyle("-fx-border-color: rgba(255,255,255,0.05); -fx-border-width: 0 0 1 0;");

        // IP info block
        VBox ipBlock = new VBox(6);
        IpInfo ip = mule.ipInfo();
        if (ip != null) {
            ipBlock.getChildren().addAll(
                ipRow(Feather.GLOBE, "IP", ip.ip(), "#e5e5e5"),
                ipRow(Feather.MAP_PIN, "LOC", joinLoc(ip), "#d4d4d4")
            );
            if (ip.org() != null && !ip.org().isBlank()) {
                ipBlock.getChildren().add(ipRow(Feather.WIFI, "ISP", ip.org(), "#a3a3a3"));
            }
            ipBlock.setStyle("-fx-background-color: rgba(10,10,10,0.5); -fx-background-radius: 12; -fx-border-color: rgba(255,255,255,0.05); -fx-border-width: 1; -fx-border-radius: 12; -fx-padding: 12;");
        } else if (running) {
            Label loading = new Label("Establishing tunnel…");
            loading.setStyle("-fx-text-fill: #34d399; -fx-font-weight: 500; -fx-font-size: 12px;");
            ipBlock.getChildren().add(loading);
            ipBlock.setStyle("-fx-background-color: rgba(10,10,10,0.5); -fx-background-radius: 12; -fx-border-color: rgba(255,255,255,0.05); -fx-border-width: 1; -fx-border-radius: 12; -fx-padding: 12;");
        }

        // Config / port
        VBox metaBlock = new VBox(6,
            kvPill("Config", mule.vpnConfig() == null ? "—" : mule.vpnConfig()),
            kvPill("RPC Port", String.valueOf(mule.rpcPort()))
        );

        // Footer actions
        Button stopBtn = new Button("Stop", Icons.of(Feather.POWER, 14, "icon-white"));
        stopBtn.getStyleClass().addAll("button", "btn-ghost");
        stopBtn.setMaxWidth(Double.MAX_VALUE);
        HBox.setHgrow(stopBtn, Priority.ALWAYS);

        Button killBtn = new Button("Kill", Icons.of(Feather.TRASH_2, 14, "icon-red"));
        killBtn.getStyleClass().addAll("button", "btn-danger");
        killBtn.setMaxWidth(Double.MAX_VALUE);
        HBox.setHgrow(killBtn, Priority.ALWAYS);

        stopBtn.setOnAction(e -> ConfirmModal.show(
            root.getScene().getWindow(), "Stop mule?",
            "Gracefully stop “" + mule.name() + "” and detach the VPN tunnel.",
            "Stop", false,
            x -> api.stopMule(mule.name())
                .whenComplete((v, err) -> Platform.runLater(onChanged))
        ));
        killBtn.setOnAction(e -> ConfirmModal.show(
            root.getScene().getWindow(), "Kill mule?",
            "Force-kill container “" + mule.name() + "”. Active torrents will be orphaned.",
            "Kill", true,
            x -> api.killMule(mule.name())
                .whenComplete((v, err) -> Platform.runLater(onChanged))
        ));

        HBox actions = new HBox(8, stopBtn, killBtn);
        actions.setStyle("-fx-border-color: rgba(255,255,255,0.05); -fx-border-width: 1 0 0 0;");
        actions.setPadding(new Insets(12, 0, 0, 0));

        root.getChildren().addAll(header, ipBlock, metaBlock, actions);
    }

    private static String joinLoc(IpInfo ip) {
        StringBuilder sb = new StringBuilder();
        if (ip.city() != null && !ip.city().isBlank()) sb.append(ip.city());
        if (ip.region() != null && !ip.region().isBlank()) { if (sb.length() > 0) sb.append(", "); sb.append(ip.region()); }
        if (ip.country() != null && !ip.country().isBlank()) { if (sb.length() > 0) sb.append(", "); sb.append(ip.country()); }
        return sb.length() == 0 ? "—" : sb.toString();
    }

    private HBox ipRow(org.kordamp.ikonli.feather.Feather icon, String k, String v, String color) {
        Label label = new Label(k);
        label.getStyleClass().add("uppercase-label");
        HBox left = new HBox(6, Icons.of(icon, 13, "icon-muted"), label);
        left.setAlignment(Pos.CENTER_LEFT);
        Region sp = new Region();
        HBox.setHgrow(sp, Priority.ALWAYS);
        Label val = new Label(v);
        val.setStyle("-fx-text-fill: " + color + "; -fx-font-family: monospace; -fx-font-size: 12px;");
        val.setMaxWidth(170);
        HBox row = new HBox(8, left, sp, val);
        row.setAlignment(Pos.CENTER_LEFT);
        return row;
    }

    private HBox kvPill(String k, String v) {
        Label lk = new Label(k);
        lk.getStyleClass().add("muted-xs");
        Region sp = new Region();
        HBox.setHgrow(sp, Priority.ALWAYS);
        Label lv = new Label(v);
        lv.getStyleClass().addAll("mono");
        lv.setStyle("-fx-text-fill: #d4d4d4; -fx-font-size: 12px;");
        lv.setMaxWidth(170);
        HBox h = new HBox(8, lk, sp, lv);
        h.setAlignment(Pos.CENTER_LEFT);
        h.setStyle("-fx-background-color: rgba(255,255,255,0.04); -fx-background-radius: 8; -fx-padding: 6 10 6 10;");
        return h;
    }
}
