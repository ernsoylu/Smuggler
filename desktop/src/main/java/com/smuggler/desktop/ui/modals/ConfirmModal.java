package com.smuggler.desktop.ui.modals;

import com.smuggler.desktop.ui.Icons;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.CheckBox;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Priority;
import javafx.scene.layout.Region;
import javafx.scene.layout.VBox;
import javafx.stage.Window;
import org.kordamp.ikonli.feather.Feather;

import java.util.function.Consumer;

/** Generic confirm modal, with optional "delete files" checkbox. */
public final class ConfirmModal {

    public static void show(Window owner, String title, String message, String confirmText,
                            boolean destructive, Consumer<Boolean> onConfirm) {
        show(owner, title, message, confirmText, destructive, null, onConfirm);
    }

    public static void show(Window owner, String title, String message, String confirmText,
                            boolean destructive, String checkboxText, Consumer<Boolean> onConfirm) {

        Label h = new Label(title);
        h.getStyleClass().add("h2");
        Label m = new Label(message);
        m.getStyleClass().add("muted");
        m.setWrapText(true);

        VBox body = new VBox(14);

        CheckBox cb = null;
        if (checkboxText != null) {
            cb = new CheckBox(checkboxText);
        }

        Button cancel = new Button("Cancel");
        cancel.getStyleClass().addAll("button", "btn-ghost");
        Button ok = new Button(confirmText, Icons.of(destructive ? Feather.TRASH_2 : Feather.CHECK, 14, "icon-white"));
        ok.getStyleClass().addAll("button", destructive ? "btn-danger" : "btn-primary");

        Region spacer = new Region();
        HBox.setHgrow(spacer, Priority.ALWAYS);
        HBox actions = new HBox(10, spacer, cancel, ok);
        actions.setAlignment(Pos.CENTER_RIGHT);

        body.getChildren().addAll(h, m);
        if (cb != null) body.getChildren().add(cb);
        body.getChildren().add(actions);

        Modal modal = new Modal(body, 460, checkboxText == null ? 220 : 260);
        final CheckBox cbFinal = cb;
        cancel.setOnAction(e -> modal.close());
        ok.setOnAction(e -> {
            boolean checked = cbFinal != null && cbFinal.isSelected();
            modal.close();
            if (onConfirm != null) onConfirm.accept(checked);
        });
        modal.showAnd(owner);
    }
}
