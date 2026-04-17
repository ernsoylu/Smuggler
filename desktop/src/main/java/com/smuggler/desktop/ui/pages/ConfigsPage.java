package com.smuggler.desktop.ui.pages;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.VpnConfig;
import com.smuggler.desktop.ui.AppShell;
import com.smuggler.desktop.ui.Icons;
import com.smuggler.desktop.ui.modals.ConfirmModal;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.PasswordField;
import javafx.scene.control.TextField;
import javafx.scene.layout.FlowPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;
import javafx.stage.FileChooser;
import org.kordamp.ikonli.feather.Feather;
import org.kordamp.ikonli.javafx.FontIcon;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;

public final class ConfigsPage implements AppShell.Page {

    private final ApiClient api;
    private final VBox root = new VBox(22);

    private final FlowPane wgGrid = new FlowPane(16, 16);
    private final FlowPane ovpnGrid = new FlowPane(16, 16);
    private final Label wgHeader = sectionLabel("WIREGUARD");
    private final Label ovpnHeader = sectionLabel("OPENVPN");
    private final Label emptyLabel = new Label("No VPN configurations stored yet. Upload a WireGuard (.conf) or OpenVPN (.ovpn) config above.");
    private final Label countBadge = new Label("0");

    private Path selectedFile;
    private boolean requiresAuth;
    private String detectedType = "wireguard";

    private final TextField nameField = new TextField();
    private final TextField userField = new TextField();
    private final PasswordField passField = new PasswordField();
    private final Label fileStatus = new Label("Select .conf or .ovpn");
    private final Label authStatus = new Label("");
    private final Label errorLabel = new Label("");
    private final VBox credsBox = new VBox(8);
    private final Button uploadBtn = new Button("Upload");
    private List<VpnConfig> configs = Collections.emptyList();

    public ConfigsPage(ApiClient api) {
        this.api = api;
        root.getStyleClass().add("page-content");
        build();
        refresh();
    }

    @Override public Node node() { return root; }

    private void build() {
        Label title = new Label("VPN Configurations");
        title.getStyleClass().add("page-title");
        Label subtitle = new Label("Upload WireGuard (.conf) or OpenVPN (.ovpn) configs. Deploy mules directly from stored configurations.");
        subtitle.getStyleClass().add("page-subtitle");
        VBox titleBlock = new VBox(4, title, subtitle);

        VBox uploadCard = buildUploadCard();

        Label listHeader = new Label("Stored Configurations");
        listHeader.setStyle("-fx-text-fill: #fafafa; -fx-font-weight: bold; -fx-font-size: 16px;");
        countBadge.getStyleClass().add("badge-count");
        HBox listHead = new HBox(10, listHeader, countBadge);
        listHead.setAlignment(Pos.CENTER_LEFT);

        wgGrid.setPrefWrapLength(900);
        ovpnGrid.setPrefWrapLength(900);

        VBox wgSection = new VBox(10, wgHeader, wgGrid);
        VBox ovpnSection = new VBox(10, ovpnHeader, ovpnGrid);

        emptyLabel.getStyleClass().addAll("empty-state", "muted");
        emptyLabel.setWrapText(true);
        emptyLabel.setMaxWidth(Double.MAX_VALUE);
        emptyLabel.setAlignment(Pos.CENTER);
        emptyLabel.setPadding(new Insets(40));

        root.getChildren().addAll(titleBlock, uploadCard, listHead, wgSection, ovpnSection, emptyLabel);
    }

    private VBox buildUploadCard() {
        Label h = new Label("Upload Configuration");
        h.setGraphic(Icons.of(Feather.PLUS, 18, "icon-emerald"));
        h.setStyle("-fx-text-fill: #fafafa; -fx-font-weight: 600; -fx-font-size: 14px;");
        h.setContentDisplay(javafx.scene.control.ContentDisplay.LEFT);
        h.setGraphicTextGap(8);

        Label fileLabel = new Label("CONFIG FILE");
        fileLabel.getStyleClass().add("uppercase-label");
        Button pickBtn = new Button();
        pickBtn.setGraphic(buildFileRow());
        pickBtn.getStyleClass().addAll("button", "btn-ghost");
        pickBtn.setMaxWidth(Double.MAX_VALUE);
        pickBtn.setOnAction(e -> pickFile());

        Label nameLabel = new Label("NAME (OPTIONAL)");
        nameLabel.getStyleClass().add("uppercase-label");
        nameField.setPromptText("e.g. US West");
        nameField.getStyleClass().add("text-field");

        uploadBtn.setGraphic(Icons.of(Feather.UPLOAD, 14, "icon-white"));
        uploadBtn.getStyleClass().addAll("button", "btn-emerald");
        uploadBtn.setOnAction(e -> doUpload());

        VBox fileBox = new VBox(6, fileLabel, pickBtn);
        VBox nameBox = new VBox(6, nameLabel, nameField);
        HBox.setHgrow(fileBox, Priority.ALWAYS);
        HBox.setHgrow(nameBox, Priority.ALWAYS);

        HBox row1 = new HBox(12, fileBox, nameBox, uploadBtn);
        row1.setAlignment(Pos.BOTTOM_LEFT);

        // Credentials (hidden by default)
        Label credsTitle = new Label("OPENVPN CREDENTIALS REQUIRED");
        credsTitle.setGraphic(Icons.of(Feather.KEY, 12, "icon-violet"));
        credsTitle.setContentDisplay(javafx.scene.control.ContentDisplay.LEFT);
        credsTitle.setGraphicTextGap(6);
        credsTitle.getStyleClass().add("uppercase-label");
        credsTitle.setStyle("-fx-text-fill: #c4b5fd;");

        Label uLabel = new Label("Username"); uLabel.getStyleClass().add("muted-xs");
        userField.setPromptText("VPN username"); userField.getStyleClass().add("text-field");
        Label pLabel = new Label("Password"); pLabel.getStyleClass().add("muted-xs");
        passField.setPromptText("VPN password"); passField.getStyleClass().add("text-field");

        VBox uBox = new VBox(4, uLabel, userField);
        VBox pBox = new VBox(4, pLabel, passField);
        HBox.setHgrow(uBox, Priority.ALWAYS);
        HBox.setHgrow(pBox, Priority.ALWAYS);
        HBox credRow = new HBox(12, uBox, pBox);

        credsBox.getChildren().addAll(credsTitle, credRow);
        credsBox.setStyle("-fx-background-color: rgba(139,92,246,0.05); -fx-background-radius: 12; -fx-border-color: rgba(139,92,246,0.2); -fx-border-radius: 12; -fx-border-width: 1; -fx-padding: 16;");
        credsBox.setVisible(false);
        credsBox.setManaged(false);

        authStatus.getStyleClass().add("muted-xs");
        errorLabel.setStyle("-fx-text-fill: #fca5a5; -fx-font-size: 12px;");

        VBox card = new VBox(14, h, row1, authStatus, credsBox, errorLabel);
        card.getStyleClass().add("card");
        card.setMaxWidth(820);
        card.setPadding(new Insets(20));
        return card;
    }

    private HBox buildFileRow() {
        FontIcon icon = Icons.of(Feather.FILE_TEXT, 16, "icon-muted");
        fileStatus.setStyle("-fx-text-fill: #a3a3a3; -fx-font-size: 13px;");
        HBox h = new HBox(10, icon, fileStatus);
        h.setAlignment(Pos.CENTER_LEFT);
        h.setPadding(new Insets(4, 0, 4, 0));
        return h;
    }

    private void pickFile() {
        FileChooser fc = new FileChooser();
        fc.setTitle("Select VPN configuration");
        fc.getExtensionFilters().add(new FileChooser.ExtensionFilter("VPN configs", "*.conf", "*.ovpn"));
        java.io.File f = fc.showOpenDialog(root.getScene().getWindow());
        if (f == null) return;
        selectedFile = f.toPath();
        String fname = f.getName().toLowerCase();
        detectedType = fname.endsWith(".ovpn") ? "openvpn" : "wireguard";
        requiresAuth = detectedType.equals("openvpn") && detectOvpnAuth(selectedFile);

        fileStatus.setText(f.getName());
        fileStatus.setStyle("-fx-text-fill: "
            + (detectedType.equals("openvpn") ? "#c4b5fd" : "#34d399")
            + "; -fx-font-size: 13px; -fx-font-weight: 500;");

        if (detectedType.equals("openvpn")) {
            authStatus.setText(requiresAuth
                ? "OpenVPN detected — credentials required."
                : "OpenVPN detected — no credentials required.");
        } else {
            authStatus.setText("WireGuard detected.");
        }
        credsBox.setVisible(requiresAuth);
        credsBox.setManaged(requiresAuth);
        errorLabel.setText("");
    }

    private static boolean detectOvpnAuth(Path p) {
        try {
            for (String line : Files.readAllLines(p)) {
                String t = line.trim();
                if (t.isEmpty() || t.startsWith("#") || t.startsWith(";")) continue;
                String[] parts = t.split("\\s+");
                if (parts.length == 1 && parts[0].equalsIgnoreCase("auth-user-pass")) return true;
            }
        } catch (IOException ignored) {}
        return false;
    }

    private void doUpload() {
        if (selectedFile == null) { errorLabel.setText("Select a config file."); return; }
        if (requiresAuth && (userField.getText().isBlank() || passField.getText().isBlank())) {
            errorLabel.setText("Username and password are required for this config.");
            return;
        }
        errorLabel.setText("");
        uploadBtn.setDisable(true);
        uploadBtn.setText("Uploading…");

        String customName = nameField.getText() == null ? null : nameField.getText().trim();
        api.uploadConfig(selectedFile, customName, userField.getText(), passField.getText())
            .whenComplete((v, err) -> Platform.runLater(() -> {
                uploadBtn.setDisable(false);
                uploadBtn.setText("Upload");
                if (err != null) {
                    errorLabel.setText("Failed: " + err.getMessage());
                    return;
                }
                // reset
                selectedFile = null;
                requiresAuth = false;
                nameField.clear();
                userField.clear();
                passField.clear();
                fileStatus.setText("Select .conf or .ovpn");
                fileStatus.setStyle("-fx-text-fill: #a3a3a3; -fx-font-size: 13px;");
                authStatus.setText("");
                credsBox.setVisible(false);
                credsBox.setManaged(false);
                refresh();
            }));
    }

    private void refresh() {
        api.getConfigs().whenComplete((list, err) -> {
            if (err != null || list == null) return;
            Platform.runLater(() -> applyConfigs(list));
        });
    }

    private void applyConfigs(List<VpnConfig> list) {
        this.configs = list;
        countBadge.setText(String.valueOf(list.size()));
        wgGrid.getChildren().clear();
        ovpnGrid.getChildren().clear();
        for (VpnConfig c : list) {
            Node card = buildConfigCard(c);
            if ("openvpn".equalsIgnoreCase(c.vpnType())) {
                ovpnGrid.getChildren().add(card);
            } else {
                wgGrid.getChildren().add(card);
            }
        }
        boolean hasWg = !wgGrid.getChildren().isEmpty();
        boolean hasOvpn = !ovpnGrid.getChildren().isEmpty();
        wgHeader.setVisible(hasWg); wgHeader.setManaged(hasWg);
        wgGrid.setVisible(hasWg); wgGrid.setManaged(hasWg);
        ovpnHeader.setVisible(hasOvpn); ovpnHeader.setManaged(hasOvpn);
        ovpnGrid.setVisible(hasOvpn); ovpnGrid.setManaged(hasOvpn);

        boolean empty = list.isEmpty();
        emptyLabel.setVisible(empty); emptyLabel.setManaged(empty);
    }

    private Node buildConfigCard(VpnConfig cfg) {
        boolean isOvpn = "openvpn".equalsIgnoreCase(cfg.vpnType());

        FontIcon iconBox = Icons.of(isOvpn ? Feather.LOCK : Feather.SHIELD, 18,
            isOvpn ? "icon-violet" : "icon-emerald");
        Label iconBadge = new Label();
        iconBadge.setGraphic(iconBox);
        iconBadge.setPrefSize(36, 36);
        iconBadge.setAlignment(Pos.CENTER);
        iconBadge.setStyle("-fx-background-color: " + (isOvpn ? "rgba(139,92,246,0.1)" : "rgba(16,185,129,0.1)")
            + "; -fx-background-radius: 8;");

        Label name = new Label(cfg.name());
        name.setStyle("-fx-text-fill: #fafafa; -fx-font-weight: 600; -fx-font-size: 13px;");
        Label fn = new Label(cfg.filename());
        fn.getStyleClass().addAll("muted-xs", "mono");
        VBox texts = new VBox(2, name, fn);
        HBox header = new HBox(10, iconBadge, texts);
        header.setAlignment(Pos.CENTER_LEFT);

        HBox typeRow = pillRow("Type", typeBadge(isOvpn));
        VBox meta = new VBox(6, typeRow);
        if (isOvpn) {
            Label authPill = new Label(cfg.requiresAuth() ? "Credentials stored" : "Not required");
            authPill.setStyle("-fx-font-size: 11px; -fx-font-weight: 600; -fx-text-fill: "
                + (cfg.requiresAuth() ? "#fbbf24" : "#a3a3a3") + ";");
            meta.getChildren().add(pillRow("Auth", authPill));
        }
        if (cfg.createdAt() != null) {
            Label added = new Label(cfg.createdAt().substring(0, Math.min(10, cfg.createdAt().length())));
            added.setStyle("-fx-text-fill: #d4d4d4; -fx-font-size: 11px;");
            meta.getChildren().add(pillRow("Added", added));
        }

        Button deployBtn = new Button("Deploy Mule", Icons.of(Feather.SEND, 14, "icon-white"));
        deployBtn.getStyleClass().addAll("button", "btn-primary");
        deployBtn.setMaxWidth(Double.MAX_VALUE);
        HBox.setHgrow(deployBtn, Priority.ALWAYS);
        deployBtn.setOnAction(e -> {
            deployBtn.setDisable(true);
            deployBtn.setText("Deploying…");
            api.deployMuleFromConfig(cfg.id(), null).whenComplete((m, err) -> Platform.runLater(() -> {
                deployBtn.setDisable(false);
                deployBtn.setText("Deploy Mule");
            }));
        });

        Button deleteBtn = new Button();
        deleteBtn.setGraphic(Icons.of(Feather.TRASH_2, 16, "icon-red"));
        deleteBtn.getStyleClass().addAll("button", "btn-icon", "btn-icon-red");
        deleteBtn.setOnAction(e -> ConfirmModal.show(
            root.getScene().getWindow(), "Delete configuration?",
            "Permanently delete \"" + cfg.name() + "\". Running mules are not affected.",
            "Delete", true,
            ok -> api.deleteConfig(cfg.id()).whenComplete((v, err) -> Platform.runLater(this::refresh))
        ));

        HBox actions = new HBox(8, deployBtn, deleteBtn);

        VBox card = new VBox(14, header, meta, actions);
        card.getStyleClass().addAll("card", "card-hover");
        card.setPrefWidth(280);
        card.setMinWidth(260);
        card.setMaxWidth(320);
        return card;
    }

    private HBox pillRow(String k, Node value) {
        Label lk = new Label(k);
        lk.getStyleClass().add("muted-xs");
        Region sp = new Region();
        HBox.setHgrow(sp, Priority.ALWAYS);
        HBox h = new HBox(8, lk, sp, value);
        h.setAlignment(Pos.CENTER_LEFT);
        h.setStyle("-fx-background-color: rgba(255,255,255,0.04); -fx-background-radius: 8; -fx-padding: 6 10 6 10;");
        return h;
    }

    private Label typeBadge(boolean isOvpn) {
        Label l = new Label(isOvpn ? "OPENVPN" : "WIREGUARD");
        l.getStyleClass().addAll("status-pill", isOvpn ? "status-paused" : "status-active");
        return l;
    }

    private static Label sectionLabel(String text) {
        Label l = new Label(text);
        l.getStyleClass().add("uppercase-label");
        return l;
    }
}
