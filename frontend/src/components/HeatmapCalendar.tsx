import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../api";
import { COLORS, EMOTION_COLORS } from "../theme";

/**
 * HeatmapCalendar — GitHub-style 90-day grid showing the dominant emotion + intensity
 * for every day. Empty cells are subtle grey. Frozen days carry a snowflake.
 *
 * Layout: weeks are columns (Mon–Sun rows). Most recent week on the right.
 */

type Cell = {
  day_key: string; // "YYYY-MM-DD"
  emotion: string;
  intensity: number;
  color?: string | null;
};

type HeatmapData = {
  days: number;
  from: string;
  to: string;
  cells: Cell[];
  frozen_days: string[];
};

const CELL_SIZE = 14;
const CELL_GAP = 3;
const ROW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function formatDayKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthLabelShort(d: Date) {
  return d.toLocaleString("en", { month: "short" });
}

export default function HeatmapCalendar({ days = 90 }: { days?: number }) {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api<HeatmapData>(`/moods/heatmap?days=${days}`);
        if (alive) setData(res);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [days]);

  // Build a 7×N grid: each column = 1 ISO week (Mon→Sun).
  const grid = useMemo(() => {
    if (!data) return null;
    const cellsByDay: Record<string, Cell> = {};
    for (const c of data.cells) cellsByDay[c.day_key] = c;
    const frozenSet = new Set(data.frozen_days || []);

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    // Anchor end of grid = today; start = today - (days-1)
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));
    // Snap start back to Monday so the grid aligns weekly.
    const dayOfWeek = (start.getDay() + 6) % 7; // 0=Mon..6=Sun
    start.setDate(start.getDate() - dayOfWeek);

    const columns: { week: { key: string; cell?: Cell; frozen: boolean; future: boolean }[] }[] = [];
    const cur = new Date(start);
    let curWeek: any[] = [];
    const monthMarkers: { col: number; label: string }[] = [];
    let lastMonth = -1;

    while (cur <= today || curWeek.length > 0) {
      const key = formatDayKey(cur);
      const isFuture = cur > today;
      curWeek.push({
        key,
        cell: cellsByDay[key],
        frozen: frozenSet.has(key),
        future: isFuture,
      });
      // First day of week → record month label if month changed
      if (curWeek.length === 1) {
        const m = cur.getMonth();
        if (m !== lastMonth) {
          monthMarkers.push({ col: columns.length, label: monthLabelShort(cur) });
          lastMonth = m;
        }
      }
      if (curWeek.length === 7) {
        columns.push({ week: curWeek });
        curWeek = [];
      }
      cur.setDate(cur.getDate() + 1);
      if (cur > today && curWeek.length === 0) break;
    }
    if (curWeek.length > 0) {
      while (curWeek.length < 7) {
        curWeek.push({ key: "", future: true, frozen: false });
      }
      columns.push({ week: curWeek });
    }
    return { columns, monthMarkers };
  }, [data, days]);

  if (loading && !data) {
    return (
      <View style={styles.loadingBlock}>
        <ActivityIndicator color="#A78BFA" />
      </View>
    );
  }
  if (!data || !grid) {
    return null;
  }

  const totalDrops = data.cells.length;

  return (
    <View style={styles.wrap} testID="heatmap-calendar">
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="calendar" size={14} color="#A78BFA" />
          <Text style={styles.title}>Last {data.days} days</Text>
        </View>
        <Text style={styles.subtle}>
          {totalDrops} aura{totalDrops === 1 ? "" : "s"}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 8 }}
        // Start scrolled all the way right (most recent on the right edge)
        contentOffset={{ x: 9999, y: 0 }}
      >
        <View style={{ flexDirection: "row" }}>
          {/* Day-of-week labels */}
          <View style={{ marginRight: 4, justifyContent: "space-between", paddingTop: 18, paddingBottom: 4 }}>
            {ROW_LABELS.map((l, i) => (
              <Text key={i} style={[styles.dowLabel, { opacity: i % 2 === 0 ? 0.85 : 0 }]}>
                {l}
              </Text>
            ))}
          </View>

          {/* Grid */}
          <View>
            {/* Month strip */}
            <View style={{ flexDirection: "row", height: 14, marginBottom: 4 }}>
              {grid.columns.map((_, idx) => {
                const marker = grid.monthMarkers.find((m) => m.col === idx);
                return (
                  <View key={idx} style={{ width: CELL_SIZE + CELL_GAP }}>
                    {marker ? <Text style={styles.monthLbl}>{marker.label}</Text> : null}
                  </View>
                );
              })}
            </View>

            {/* Cells */}
            <View style={{ flexDirection: "row" }}>
              {grid.columns.map((col, ci) => (
                <View key={ci} style={{ marginRight: CELL_GAP }}>
                  {col.week.map((d, ri) => {
                    if (d.future || !d.key) {
                      return <View key={ri} style={[styles.cell, styles.cellFuture]} />;
                    }
                    if (d.cell) {
                      const meta = EMOTION_COLORS[d.cell.emotion];
                      const base = d.cell.color || meta?.hex || "#A78BFA";
                      const pct = Math.max(0.25, Math.min(1, d.cell.intensity / 10));
                      // Convert hex base into rgba with intensity-driven opacity.
                      return (
                        <View
                          key={ri}
                          style={[styles.cell, { backgroundColor: hexToRgba(base, pct) }]}
                        />
                      );
                    }
                    if (d.frozen) {
                      return (
                        <View key={ri} style={[styles.cell, styles.cellFrozen]}>
                          <Ionicons name="snow" size={9} color="#7DD3FC" />
                        </View>
                      );
                    }
                    return <View key={ri} style={[styles.cell, styles.cellEmpty]} />;
                  })}
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.subtle}>Less</Text>
        {[0.25, 0.45, 0.65, 0.85, 1.0].map((p, i) => (
          <View key={i} style={[styles.legendDot, { backgroundColor: hexToRgba("#A78BFA", p) }]} />
        ))}
        <Text style={styles.subtle}>More</Text>
        <View style={{ width: 12 }} />
        <Ionicons name="snow" size={11} color="#7DD3FC" />
        <Text style={styles.subtle}>frozen</Text>
      </View>
    </View>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(167,139,250,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 6,
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  loadingBlock: { padding: 18, alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  title: { color: "#fff", fontSize: 13, fontWeight: "700", letterSpacing: 0.3 },
  subtle: { color: COLORS.textTertiary, fontSize: 11 },
  monthLbl: { color: COLORS.textTertiary, fontSize: 10 },
  dowLabel: { color: COLORS.textTertiary, fontSize: 9, height: CELL_SIZE + CELL_GAP, textAlign: "right", width: 12 },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 3,
    marginBottom: CELL_GAP,
    alignItems: "center",
    justifyContent: "center",
  },
  cellEmpty: { backgroundColor: "rgba(255,255,255,0.05)" },
  cellFuture: { backgroundColor: "transparent" },
  cellFrozen: { backgroundColor: "rgba(125,211,252,0.18)", borderWidth: 1, borderColor: "rgba(125,211,252,0.45)" },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  legendDot: { width: 12, height: 12, borderRadius: 3, marginHorizontal: 1 },
});
