package com.smuggler.desktop.ui.modals;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.VpnConfig;
import com.smuggler.desktop.ui.Icons;
import javafx.application.Platform;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ListCell;
import javafx.scene.control.ListView;
import javafx.scene.control.TextField;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;
import javafx.stage.Window;
import org.kordamp.ikonli.feather.Feather;

import java.util.List;

/** Select a stored VPN config and deploy a mule from it. */
public final class DeployMuleModal {

    private final ApiClient api;
    private final Runnable onDone;

    public DeployMuleModal(ApiClient api, Runnable onDone) {
        this.api = api;
        this.onDone = onDone == null ? () -> {} : onDone;
    }

    public void show(Window owner) {
        Label title = new Label("Deploy Mule");
        title.getStyleClass().add("h2");
        Label subtitle = new Label("Choose a stored VPN configuration and spin up a new isolated mule container.");
        subtitle.setWrapText(true);
        subtitle.getStyleClass().add("muted");

        Label sectionLabel = new Label("STORED CONFIGURATIONS");
        sectionLabel.getStyleClass().add("uppercase-label");

        ListView<VpnConfig> list = new ListView<>();
        list.setPrefHeight(260);
        list.setCellFactory(lv -> new ListCell<>() {
            @Override protected void updateItem(VpnConfig cfg, boolean empty) {
                super.updateItem(cfg, empty);
                if (empty || cfg == null) { setText(null); setGraphic(null); return; }
                boolean isOvpn = "openvpn".equalsIgnoreCase(cfg.vpnType());
                Label badge = new Label(isOvpn ? "OPENVPN" : "WIREGUARD");
                badge.getStyleClass().addAll("status-pill", isOvpn ? "status-paused" : "status-active");
                Label name = new Label(cfg.name());
                name.setStyle("-fx-text-fill: #fafafa; -fx-font-weight: 500;");
                Label fn = new Label(cfg.filename());
                fn.getStyleClass().addAll("muted-xs", "mono");
                VBox texts = new VBox(2, name, fn);
                if (cfg.inUse()) {
                    Label tag = new Label("In use by " + cfg.inUseByMule());
                    tag.setStyle("-fx-text-fill: #fbbf24; -fx-font-size: 11px;");
                    texts.getChildren().add(tag);
                }
                Region sp = new Region(); HBox.setHgrow(sp, Priority.ALWAYS);
                HBox row = new HBox(10, texts, sp, badge);
                row.setAlignment(Pos.CENTER_LEFT);
                setGraphic(row);
                setText(null);
                setDisable(cfg.inUse());
                setOpacity(cfg.inUse() ? 0.5 : 1.0);
            }
        });

        // Optional name field
        Label nameLabel = new Label("MULE NAME (OPTIONAL)");
        nameLabel.getStyleClass().add("uppercase-label");
        TextField nameField = new TextField();
        nameField.setPromptText("auto-generated if empty");

        Label status = new Label("");
        status.getStyleClass().add("muted");

        Button cancel = new Button("Cancel");
        cancel.getStyleClass().addAll("button", "btn-ghost");
        Button deploy = new Button("Deploy", Icons.of(Feather.SEND, 14, "icon-white"));
        deploy.getStyleClass().addAll("button", "btn-primary");

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);
        HBox actions = new HBox(10, spacer, cancel, deploy);

        VBox body = new VBox(16, title, subtitle, sectionLabel, list,
            new VBox(6, nameLabel, nameField), status, actions);

        Modal modal = new Modal(body, 560, 540);

        // Load configs
        api.getConfigs().whenComplete((cfgs, err) -> Platform.runLater(() -> {
            if (err != null || cfgs == null) { status.setText("Failed to load configs."); return; }
            list.getItems().setAll(cfgs);
            for (int i = 0; i < cfgs.size(); i++) {
                if (!cfgs.get(i).inUse()) { list.getSelectionModel().select(i); break; }
            }
        }));

        list.getSelectionModel().selectedItemProperty().addListener((obs, oldVal, newVal) ->
            deploy.setDisable(newVal == null || newVal.inUse()));

        cancel.setOnAction(e -> modal.close());
        deploy.setOnAction(e -> {
            VpnConfig sel = list.getSelectionModel().getSelectedItem();
            if (sel == null) { status.setText("Select a configuration."); return; }
            if (sel.inUse()) { status.setText("This config is already in use by " + sel.inUseByMule() + "."); return; }
            deploy.setDisable(true);
            status.setText("Deploying…");
            String customName = nameField.getText() == null ? null : nameField.getText().trim();
            api.deployMuleFromConfig(sel.id(), customName).whenComplete((m, err) -> Platform.runLater(() -> {
                if (err != null) {
                    status.setText("Failed: " + err.getMessage());
                    deploy.setDisable(false);
                } else {
                    onDone.run();
                    modal.close();
                }
            }));
        });

        modal.showAnd(owner);
    }
}
