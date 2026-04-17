package com.smuggler.desktop.ui;

import javafx.application.Platform;
import javafx.collections.FXCollections;
import javafx.scene.chart.AreaChart;
import javafx.scene.chart.NumberAxis;
import javafx.scene.chart.XYChart;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Rolling dual-series area chart (download + upload). Mirrors the web's
 * SpeedGraph — accepts (down, up) bytes/sec points and keeps a bounded
 * history for plotting.
 */
public final class SpeedGraph {

    private static final int MAX_POINTS = 60;

    private final NumberAxis xAxis = new NumberAxis();
    private final NumberAxis yAxis = new NumberAxis();
    private final AreaChart<Number, Number> chart;

    private final XYChart.Series<Number, Number> downSeries = new XYChart.Series<>();
    private final XYChart.Series<Number, Number> upSeries = new XYChart.Series<>();

    private final Deque<long[]> history = new ArrayDeque<>();
    private long startedAt = System.currentTimeMillis();

    public SpeedGraph() {
        xAxis.setAutoRanging(true);
        xAxis.setTickLabelsVisible(false);
        xAxis.setTickMarkVisible(false);
        xAxis.setMinorTickVisible(false);
        xAxis.setForceZeroInRange(false);

        yAxis.setAutoRanging(true);
        yAxis.setMinorTickVisible(false);
        yAxis.setTickLabelFormatter(new NumberAxis.DefaultFormatter(yAxis) {
            @Override public String toString(Number v) {
                double n = v.doubleValue();
                if (n >= 1_048_576) return String.format("%.1fM", n / 1_048_576);
                if (n >= 1_024)     return String.format("%.0fK", n / 1_024);
                return String.format("%.0f", n);
            }
        });

        chart = new AreaChart<>(xAxis, yAxis);
        chart.getStyleClass().add("speed-chart");
        chart.setLegendVisible(false);
        chart.setAnimated(false);
        chart.setCreateSymbols(false);
        chart.setVerticalGridLinesVisible(false);
        chart.setHorizontalGridLinesVisible(true);

        downSeries.setName("Download");
        upSeries.setName("Upload");
        chart.setData(FXCollections.observableArrayList(downSeries, upSeries));

        chart.setMinHeight(120);
        chart.setPrefHeight(150);
    }

    public AreaChart<Number, Number> node() { return chart; }

    public void push(long downBps, long upBps) {
        long t = System.currentTimeMillis() - startedAt;
        history.addLast(new long[] { t, downBps, upBps });
        while (history.size() > MAX_POINTS) history.pollFirst();
        Platform.runLater(this::rerender);
    }

    private void rerender() {
        downSeries.getData().clear();
        upSeries.getData().clear();
        for (long[] p : history) {
            downSeries.getData().add(new XYChart.Data<>(p[0], p[1]));
            upSeries.getData().add(new XYChart.Data<>(p[0], p[2]));
        }
    }
}
