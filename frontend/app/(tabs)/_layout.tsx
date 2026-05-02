import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../src/theme";
import { BlurView } from "expo-blur";
import { StyleSheet, View, Platform } from "react-native";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          bottom: 16,
          left: 16,
          right: 16,
          height: 68,
          borderRadius: 34,
          backgroundColor: "rgba(10,10,12,0.85)",
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
          paddingHorizontal: 6,
          paddingBottom: 8,
          paddingTop: 10,
          elevation: 8,
          shadowColor: "#000",
          shadowOpacity: 0.5,
          shadowRadius: 12,
        },
        tabBarActiveTintColor: "#fff",
        tabBarInactiveTintColor: "rgba(255,255,255,0.45)",
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginBottom: 2 },
        tabBarIcon: ({ color, focused }) => {
          const names: Record<string, any> = {
            home: focused ? "radio-button-on" : "radio-button-off",
            create: "add-circle",
            friends: focused ? "people" : "people-outline",
            stats: focused ? "stats-chart" : "stats-chart-outline",
            profile: focused ? "person" : "person-outline",
          };
          const size = route.name === "create" ? 34 : 22;
          return <Ionicons name={names[route.name] || "ellipse"} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="friends" options={{ title: "Friends" }} />
      <Tabs.Screen name="create" options={{ title: "Drop" }} />
      <Tabs.Screen name="stats" options={{ title: "Stats" }} />
      <Tabs.Screen name="profile" options={{ title: "Me" }} />
    </Tabs>
  );
}
