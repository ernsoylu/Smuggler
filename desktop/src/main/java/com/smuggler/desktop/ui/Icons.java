package com.smuggler.desktop.ui;

import org.kordamp.ikonli.feather.Feather;
import org.kordamp.ikonli.javafx.FontIcon;

/** Small helpers to build Feather icons (Lucide-equivalent) at consistent sizes. */
public final class Icons {
    private Icons() {}

    public static FontIcon of(Feather f, int size) {
        FontIcon i = new FontIcon(f);
        i.setIconSize(size);
        return i;
    }

    public static FontIcon of(Feather f, int size, String colorClass) {
        FontIcon i = of(f, size);
        i.getStyleClass().add(colorClass);
        return i;
    }
}
