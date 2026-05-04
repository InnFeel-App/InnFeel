import React, { useEffect, useState, useCallback } from "react";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../src/theme";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../../src/api";
import { useAuth } from "../../src/auth";

function UnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeTxt}>{count > 9 ? "9+" : count}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const { user } = useAuth();
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  const poll = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api<{ total: number }>("/messages/unread-count");
      setUnread(r.total || 0);
    } catch {}
  }, [user]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [poll]);

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
            messages: focused ? "chatbubbles" : "chatbubbles-outline",
            profile: focused ? "person" : "person-outline",
          };
          const size = route.name === "create" ? 34 : 22;
          return (
            <View style={{ position: "relative" }}>
              <Ionicons name={names[route.name] || "ellipse"} size={size} color={color} />
              {route.name === "messages" ? <UnreadBadge count={unread} /> : null}
            </View>
          );
        },
      })}
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="friends" options={{ title: "Friends" }} />
      <Tabs.Screen name="create" options={{ title: "Aura +" }} />
      <Tabs.Screen name="messages" options={{ title: "Inbox" }} />
      <Tabs.Screen name="profile" options={{ title: "Me" }} />
      <Tabs.Screen name="stats" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "#EC4899",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(10,10,12,1)",
  },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
});
