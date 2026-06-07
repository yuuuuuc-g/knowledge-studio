import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

const colors = {
  question: { strokeColor: "#2f6fa3", backgroundColor: "#e5f3ff" },
  concept: { strokeColor: "#8f5bd3", backgroundColor: "#f2ecff" },
  evidence: { strokeColor: "#c7862c", backgroundColor: "#fff3cf" },
  claim: { strokeColor: "#137c72", backgroundColor: "#e2f1ee" }
};

export function structureToScene(structure) {
  const nodes = structure.nodes || [];
  const nodeSkeletons = nodes.map((node, index) => {
    const color = colors[node.kind] || colors.concept;
    return {
      type: "rectangle",
      x: node.x ?? 160 + index * 220,
      y: node.y ?? 140,
      width: node.kind === "evidence" ? 420 : 250,
      height: node.kind === "evidence" ? 94 : 76,
      strokeColor: color.strokeColor,
      backgroundColor: color.backgroundColor,
      roughness: 1,
      label: {
        text: node.text,
        fontSize: node.text.length > 18 ? 18 : 22,
        strokeColor: "#20242a"
      }
    };
  });

  const arrowSkeletons = (structure.edges || [])
    .map(([from, to]) => {
      const start = nodes[from];
      const end = nodes[to];
      if (!start || !end) return null;
      return {
        type: "arrow",
        x: (start.x || 0) + 250,
        y: (start.y || 0) + 38,
        points: [
          [0, 0],
          [(end.x || 0) - (start.x || 0) - 40, (end.y || 0) - (start.y || 0)]
        ],
        strokeColor: "#8f5bd3",
        roughness: 1
      };
    })
    .filter(Boolean);

  return convertToExcalidrawElements([
    ...nodeSkeletons,
    ...arrowSkeletons,
    {
      type: "rectangle",
      x: 260,
      y: -70,
      width: 560,
      height: 86,
      strokeColor: "#d9ded6",
      backgroundColor: "#ffffff",
      roughness: 1,
      label: {
        text: structure.title || "结构图",
        fontSize: 22,
        strokeColor: "#20242a"
      }
    }
  ]);
}

export function sceneToPlainNodes(elements) {
  return elements
    .filter((element) => !element.isDeleted && ["text", "rectangle", "ellipse", "diamond"].includes(element.type))
    .slice(0, 12)
    .map((element) => ({
      text: element.text || element.id,
      kind: element.type === "text" ? "claim" : "concept"
    }));
}
