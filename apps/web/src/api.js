export async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

export async function getHealth() {
  const response = await fetch("/api/health");
  if (!response.ok) return { ok: false, aiConfigured: false };
  return response.json();
}

export async function getResources() {
  const response = await fetch("/api/resources");
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.resources) ? data.resources : [];
}

export async function uploadResource(formData) {
  const response = await fetch("/api/resources/import", {
    method: "POST",
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Upload failed: ${response.status}`);
  return data;
}

export async function deleteResource(id) {
  const response = await fetch(`/api/resources/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Delete failed: ${response.status}`);
  return data;
}
