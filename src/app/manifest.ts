import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "SmileQuest", short_name: "SmileQuest", start_url: "/dashboard", display: "standalone", orientation: "portrait", background_color: "#FAF6EE", theme_color: "#FAF6EE" };
}
