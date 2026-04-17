package com.smuggler.desktop.ui.modals;

import com.smuggler.desktop.api.ApiClient;
import com.smuggler.desktop.api.dto.Mule;
import com.smuggler.desktop.ui.Icons;
import javafx.application.Platform;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.ComboBox;
import javafx.scene.control.Label;
import javafx.scene.control.TextArea;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;
import javafx.stage.FileChooser;
import javafx.stage.Window;
import org.kordamp.ikonli.feather.Feather;

import java.io.File;
import java.util.List;

public final class AddTorrentModal {

    private final ApiClient api;
    private final List<Mule> mules;
    private final Runnable onDone;

    public AddTorrentModal(ApiClient api, List<Mule> mules, Runnable onDone) {
        this.api = api;
        this.mules = mules;
        this.onDone = onDone == null ? () -> {} : onDone;
    }

    public void show(Window owner) {
        // Top title
        Label title = new Label("Add Torrent");
        title.getStyleClass().add("h2");
        Label subtitle = new Label("Paste a magnet link or upload a .torrent file.");
        subtitle.getStyleClass().add("muted");
        VBox header = new VBox(4, title, subtitle);

        // Mule selector
        ComboBox<String> muleBox = new ComboBox<>();
        muleBox.getStyleClass().add("combo-box-base");
        if (mules != null) for (Mule m : mules) muleBox.getItems().add(m.name());
        if (!muleBox.getItems().isEmpty()) muleBox.getSelectionModel().selectFirst();

        Label muleLabel = new Label("ROUTE VIA MULE");
        muleLabel.getStyleClass().add("uppercase-label");

        VBox muleBlock = new VBox(6, muleLabel, muleBox);

        // Magnet field
        TextArea magnetField = new TextArea();
        magnetField.setPromptText("magnet:?xt=urn:btih:…");
        magnetField.setPrefRowCount(3);
        magnetField.getStyleClass().addAll("text-field", "mono");
        magnetField.setWrapText(true);

        Label magnetLabel = new Label("MAGNET LINK");
        magnetLabel.getStyleClass().add("uppercase-label");
        VBox magnetBlock = new VBox(6, magnetLabel, magnetField);

        // OR divider
        Label orLabel = new Label("— OR —");
        orLabel.getStyleClass().add("muted");

        // File picker
        Label fileLabel = new Label("TORRENT FILE");
        fileLabel.getStyleClass().add("uppercase-label");
        Label filePath = new Label("No file selected");
        filePath.getStyleClass().add("muted");
        Button pickBtn = new Button("Choose .torrent", Icons.of(Feather.UPLOAD, 14, "icon-white"));
        pickBtn.getStyleClass().addAll("button", "btn-ghost");
        File[] chosen = new File[1];
        pickBtn.setOnAction(e -> {
            FileChooser fc = new FileChooser();
            fc.setTitle("Select .torrent file");
            fc.getExtensionFilters().add(new FileChooser.ExtensionFilter("Torrent file", "*.torrent"));
            File f = fc.showOpenDialog(owner);
            if (f != null) {
                chosen[0] = f;
                filePath.setText(f.getName());
            }
        });
        HBox pickRow = new HBox(10, pickBtn, filePath);
        pickRow.setAlignment(Pos.CENTER_LEFT);
        VBox fileBlock = new VBox(6, fileLabel, pickRow);

        // Status
        Label status = new Label("");
        status.getStyleClass().add("muted");

        // Actions
        Button cancel = new Button("Cancel");
        cancel.getStyleClass().addAll("button", "btn-ghost");
        Button submit = new Button("Add", Icons.of(Feather.PLUS, 14, "icon-white"));
        submit.getStyleClass().addAll("button", "btn-primary");

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);
        HBox actions = new HBox(10, spacer, cancel, submit);

        VBox body = new VBox(18, header, muleBlock, magnetBlock, orLabel, fileBlock, status, actions);
        body.setFillWidth(true);

        Modal modal = new Modal(body, 560, 560);

        cancel.setOnAction(e -> modal.close());
        submit.setOnAction(e -> {
            String mule = muleBox.getValue();
            if (mule == null || mule.isBlank()) {
                status.setText("Select a mule first.");
                return;
            }
            String magnet = magnetField.getText() == null ? "" : magnetField.getText().trim();
            boolean useFile = chosen[0] != null;

            if (magnet.isBlank() && !useFile) {
                status.setText("Provide a magnet link or choose a .torrent file.");
                return;
            }
            submit.setDisable(true);
            status.setText("Uploading…");
            var fut = useFile
                ? api.addTorrentFile(mule, chosen[0].toPath())
                : api.addMagnet(mule, magnet);
            fut.whenComplete((res, err) -> Platform.runLater(() -> {
                if (err != null) {
                    status.setText("Failed: " + err.getMessage());
                    submit.setDisable(false);
                } else {
                    onDone.run();
                    modal.close();
                }
            }));
        });

        modal.showAnd(owner);
    }
}
