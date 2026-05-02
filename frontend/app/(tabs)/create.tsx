import React, { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

export default function CreateTab() {
  const router = useRouter();
  useEffect(() => {
    // Redirect to modal-like route
    const id = setTimeout(() => router.replace("/mood-create"), 10);
    return () => clearTimeout(id);
  }, [router]);
  return <View style={{ flex: 1, backgroundColor: "#050505" }} />;
}
