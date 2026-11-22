
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ViewportPortal,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import ShapeNode from "./ShapeNode";
import useSocketConnection from "@/hooks/useSocketConnection";
import { socket } from "@/lib/socket";
import { API } from "@/constants/api";

const nodeTypes = {
  shape: ShapeNode,
};

export default function DiagramEditor({ diagramId }) {
  const { connected } = useSocketConnection();
  const dragStartPositions = useRef(new Map());
  const [editingLabel, setEditingLabel] = useState("");
  const [editingBackground, setEditingBackground] = useState("#eef2ff");
  const [editingBorderColor, setEditingBorderColor] = useState("#6366f1");
  const lastPreviewTime = useRef(0);
  const [diagram, setDiagram] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  // COLLABORATION PRESENCE
  const [collaborators, setCollaborators] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});
  const lastCursorEmit = useRef(0);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [presenceNotice, setPresenceNotice] = useState("");
  const [roomStatus, setRoomStatus] = useState("joining");

  // SHARE / INVITATION STATE
  const [shareOpen, setShareOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("EDITOR");
  const [inviting, setInviting] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [shareError, setShareError] = useState("");

  // JOIN AND LEAVE DIAGRAM ROOM
  useEffect(() => {
    if (!diagramId) return;

    let active = true;

    const joinRoom = () => {
      if (!active) return;

      setRoomStatus("joining");

      socket.timeout(5000).emit(
        "diagram:join",
        { diagramId },
        (timeoutError, response) => {
          if (!active) return;

          if (timeoutError) {
            setRoomStatus("unavailable");
            console.warn("Diagram room service did not respond.");
            return;
          }

          if (response?.success) {
            setRoomStatus("joined");

            // Fetch the latest diagram snapshot after joining
            fetch(API.GET_DIAGRAM(diagramId), {
              credentials: "include",
            })
              .then(async (res) => {
                const result = await res.json();

                if (!res.ok || !result.success || !result.data) {
                  throw new Error("Unable to recover diagram state.");
                }

                return result.data;
              })
              .then((latestDiagram) => {
                setDiagram(latestDiagram);
                setNodes(latestDiagram.nodes);
                setEdges(latestDiagram.edges);

                console.log("Latest diagram snapshot recovered.");
              })
              .catch((error) => {
                console.error("Diagram recovery failed:", error);
              });
          } else {
            setRoomStatus("rejected");
            console.error(
              "Diagram room join rejected:",
              response?.message || "Unknown reason"
            );
          }
        }
      );
    };

    socket.on("connect", joinRoom);

    if (socket.connected) {
      joinRoom();
    } else {
      socket.connect();
    }

    return () => {
      active = false;

      socket.off("connect", joinRoom);

      if (socket.connected) {
        socket.emit("diagram:leave", { diagramId });
      }
    };
  }, [diagramId]);

  // INVITE COLLABORATOR
  const handleInvite = async (e) => {
    e.preventDefault();

    if (!inviteEmail.trim()) {
      setShareError("Please enter an email address.");
      return;
    }

    setInviting(true);
    setShareError("");
    setShareMessage("");

    try {
      const response = await fetch(
        `${API.DIAGRAMS}/${encodeURIComponent(diagramId)}/invitations`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: inviteEmail.trim().toLowerCase(),
            role: inviteRole,
          }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to invite collaborator.");
      }

      setShareMessage(
        `${inviteEmail.trim()} now has ${inviteRole.toLowerCase()} access.`
      );
      setInviteEmail("");
    } catch (error) {
      setShareError(error.message || "Invitation failed.");
    } finally {
      setInviting(false);
    }
  };
  // ADD SHAPE
  // ADD SHAPE
  const addShape = useCallback(
    (shape) => {
      const newNode = {
        id: crypto.randomUUID(),
        type: "shape",
        position: {
          x: 150 + nodes.length * 30,
          y: 100 + nodes.length * 30,
        },
        data: {
          shape,
          label: shape.charAt(0).toUpperCase() + shape.slice(1),
        },
      };

      const operationId = crypto.randomUUID();

      if (!socket.connected) {
        setError("Connection lost. Cannot add node in real time.");
        return;
      }

      socket.timeout(5000).emit(
        "node:create",
        {
          diagramId,
          operationId,
          node: newNode,
        },
        (timeoutError, response) => {
          if (timeoutError || !response?.success) {
            setError(
              response?.message || "Unable to create node on the server."
            );
            return;
          }

          setNodes((currentNodes) => {
            if (currentNodes.some((node) => node.id === newNode.id)) {
              return currentNodes;
            }

            return [...currentNodes, response.node || newNode];
          });

          setSaveMessage("");
          setError(null);
        }
      );
    },
    [diagramId, nodes.length, setNodes]
  );

  // COLLABORATOR PRESENCE AND CURSOR LISTENERS
  useEffect(() => {
    if (!diagramId) return;

    const handlePresenceUpdate = (data) => {
      if (data?.diagramId !== diagramId) return;
      setCollaborators(data.users || []);

      const activeIds = new Set(
        (data.users || []).map((user) => user.id)
      );

      setRemoteCursors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([userId]) =>
            activeIds.has(userId)
          )
        )
      );
    };

    const handleCursorUpdate = (data) => {
      if (data?.diagramId !== diagramId || !data.userId || !data.position) {
        return;
      }

      setRemoteCursors((current) => ({
        ...current,
        [data.userId]: data.position,
      }));
    };

    const handleUserJoined = (data) => {
      if (data?.diagramId !== diagramId || !data.user) return;

      setPresenceNotice(`${data.user.name} joined the diagram.`);
    };

    const handleUserLeft = (data) => {
      if (data?.diagramId !== diagramId) return;

      const userId = data?.user?.id;
      if (!userId) return;

      const user = collaborators.find((item) => item.id === userId);

      setPresenceNotice(
        `${user?.name || "A collaborator"} left the diagram.`
      );

      setRemoteCursors((current) => {
        const updated = { ...current };
        delete updated[userId];
        return updated;
      });
    };

    socket.on("presence:update", handlePresenceUpdate);
    socket.on("cursor:update", handleCursorUpdate);
    socket.on("diagram:user-left", handleUserLeft);
    socket.on("diagram:user-joined", handleUserJoined);

    return () => {
      socket.off("presence:update", handlePresenceUpdate);
      socket.off("cursor:update", handleCursorUpdate);
      socket.off("diagram:user-left", handleUserLeft);
      socket.off("diagram:user-joined", handleUserJoined);
    };
  }, [diagramId, collaborators]);

  // RECEIVE OPERATIONS FROM OTHER COLLABORATORS
  useEffect(() => {
    if (!diagramId) return;

    const handleDiagramOperation = (operation) => {
      if (operation?.diagramId !== diagramId) return;

      const { type, payload } = operation;

      switch (type) {
        case "node:create": {
          const incomingNode = payload?.node;
          if (!incomingNode) return;

          setNodes((currentNodes) => {
            if (currentNodes.some((node) => node.id === incomingNode.id)) {
              return currentNodes;
            }

            return [...currentNodes, incomingNode];
          });
          break;
        }

        case "node:move": {
          const { nodeId, position } = payload || {};
          if (!nodeId || !position) return;

          setNodes((currentNodes) =>
            currentNodes.map((node) =>
              node.id === nodeId ? { ...node, position } : node
            )
          );
          break;
        }
        case "node:move:preview": {
          const { nodeId, position } = payload || {};
          if (!nodeId || !position) return;

          setNodes((currentNodes) =>
            currentNodes.map((node) =>
              node.id === nodeId
                ? { ...node, position }
                : node
            )
          );
          break;
        }
        case "node:update": {
          const { nodeId, updates } = payload || {};
          if (!nodeId || !updates) return;

          setNodes((currentNodes) =>
            currentNodes.map((node) =>
              node.id === nodeId
                ? {
                  ...node,
                  ...updates,
                  data: updates.data
                    ? { ...node.data, ...updates.data }
                    : node.data,
                }
                : node
            )
          );
          break;
        }

        case "node:delete": {
          const { nodeId } = payload || {};
          if (!nodeId) return;

          setNodes((currentNodes) =>
            currentNodes.filter((node) => node.id !== nodeId)
          );

          setEdges((currentEdges) =>
            currentEdges.filter(
              (edge) => edge.source !== nodeId && edge.target !== nodeId
            )
          );
          break;
        }

        case "edge:create": {
          const incomingEdge = payload?.edge;
          if (!incomingEdge) return;

          setEdges((currentEdges) => {
            if (currentEdges.some((edge) => edge.id === incomingEdge.id)) {
              return currentEdges;
            }

            return [...currentEdges, incomingEdge];
          });
          break;
        }

        case "edge:delete": {
          const { edgeId } = payload || {};
          if (!edgeId) return;

          setEdges((currentEdges) =>
            currentEdges.filter((edge) => edge.id !== edgeId)
          );
          break;
        }

        default:
          return;
      }

      setSaveMessage("");
    };

    socket.on("diagram:operation", handleDiagramOperation);

    return () => {
      socket.off("diagram:operation", handleDiagramOperation);
    };
  }, [diagramId, setNodes, setEdges]);

  // LOAD DIAGRAM FROM BACKEND
  useEffect(() => {
    const controller = new AbortController();

    async function loadDiagram() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(API.GET_DIAGRAM(diagramId), {
          credentials: "include",
          signal: controller.signal,
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            result.message || "Unable to load diagram."
          );
        }

        if (
          !result.success ||
          !result.data ||
          !Array.isArray(result.data.nodes) ||
          !Array.isArray(result.data.edges)
        ) {
          throw new Error("Invalid diagram data received.");
        }

        setDiagram(result.data);
        setNodes(result.data.nodes);
        setEdges(result.data.edges);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message || "Unable to load diagram.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    if (diagramId) {
      loadDiagram();
    }

    return () => controller.abort();
  }, [diagramId, setNodes, setEdges]);
  const handleCanvasMouseMove = useCallback(
    (event) => {
      if (
        !reactFlowInstance ||
        !socket.connected ||
        roomStatus !== "joined"
      ) {
        return;
      }

      const now = Date.now();

      // Throttle to 30 updates per second.
      if (now - lastCursorEmit.current < 33) return;

      lastCursorEmit.current = now;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      socket.volatile.emit("cursor:move", {
        diagramId,
        position,
      });
    },
    [diagramId, reactFlowInstance, roomStatus]
  );
  // TRACK NODE POSITION BEFORE DRAGGING
  const onNodeDragStart = useCallback((event, node) => {
    dragStartPositions.current.set(node.id, { ...node.position });
  }, []);
  // BROADCAST LIVE NODE MOVEMENT
  // BROADCAST LIVE NODE MOVEMENT + CURSOR
  const onNodeDrag = useCallback(
    (event, node) => {
      // Keep remote cursor moving during node dragging
      handleCanvasMouseMove(event);

      if (!socket.connected || roomStatus !== "joined") return;

      const now = Date.now();

      // Limit node preview updates to approximately 20 per second.
      if (now - lastPreviewTime.current < 50) return;

      lastPreviewTime.current = now;

      socket.emit("node:move:preview", {
        diagramId,
        operationId: crypto.randomUUID(),
        nodeId: node.id,
        position: {
          x: node.position.x,
          y: node.position.y,
        },
      });
    },
    [diagramId, roomStatus, handleCanvasMouseMove]
  );
  // SYNCHRONIZE NODE MOVEMENT
  const onNodeDragStop = useCallback(
    (event, node) => {
      const previousPosition = dragStartPositions.current.get(node.id);
      dragStartPositions.current.delete(node.id);

      if (
        previousPosition &&
        previousPosition.x === node.position.x &&
        previousPosition.y === node.position.y
      ) {
        return;
      }

      const rollback = () => {
        if (!previousPosition) return;

        setNodes((currentNodes) =>
          currentNodes.map((currentNode) =>
            currentNode.id === node.id
              ? { ...currentNode, position: previousPosition }
              : currentNode
          )
        );
      };

      if (!socket.connected || roomStatus !== "joined") {
        rollback();
        setError("Not connected to the diagram room.");
        return;
      }

      socket.timeout(5000).emit(
        "node:move",
        {
          diagramId,
          operationId: crypto.randomUUID(),
          nodeId: node.id,
          position: {
            x: node.position.x,
            y: node.position.y,
          },
        },
        (timeoutError, response) => {
          if (timeoutError || !response?.success) {
            rollback();
            setError(
              response?.message || "Unable to synchronize node movement."
            );
            return;
          }

          setError(null);
          setSaveMessage("");
        }
      );
    },
    [diagramId, roomStatus, setNodes]
  );

  // SYNCHRONIZE NODE DELETION
  const handleNodesChange = useCallback(
    (changes) => {
      const deletionChanges = changes.filter(
        (change) => change.type === "remove"
      );

      const otherChanges = changes.filter(
        (change) => change.type !== "remove"
      );

      if (otherChanges.length > 0) {
        setNodes((currentNodes) =>
          applyNodeChanges(otherChanges, currentNodes)
        );
      }

      deletionChanges.forEach((change) => {
        if (!socket.connected || roomStatus !== "joined") {
          setError("Not connected. Cannot delete node.");
          return;
        }

        const operationId = crypto.randomUUID();

        socket.timeout(5000).emit(
          "node:delete",
          {
            diagramId,
            operationId,
            nodeId: change.id,
          },
          (timeoutError, response) => {
            if (timeoutError || !response?.success) {
              setError(
                response?.message || "Unable to delete node."
              );
              return;
            }

            setNodes((currentNodes) =>
              currentNodes.filter((node) => node.id !== change.id)
            );

            setEdges((currentEdges) =>
              currentEdges.filter(
                (edge) =>
                  edge.source !== change.id &&
                  edge.target !== change.id
              )
            );

            setError(null);
            setSaveMessage("");
          }
        );
      });
    },
    [diagramId, roomStatus, setNodes, setEdges]
  );

  const handleEdgesChange = useCallback(
    (changes) => {
      const deletionChanges = changes.filter(
        (change) => change.type === "remove"
      );

      const otherChanges = changes.filter(
        (change) => change.type !== "remove"
      );

      if (otherChanges.length > 0) {
        setEdges((currentEdges) =>
          applyEdgeChanges(otherChanges, currentEdges)
        );
      }

      deletionChanges.forEach((change) => {
        if (!socket.connected || roomStatus !== "joined") {
          setError("Not connected. Cannot delete connection.");
          return;
        }

        socket.timeout(5000).emit(
          "edge:delete",
          {
            diagramId,
            operationId: crypto.randomUUID(),
            edgeId: change.id,
          },
          (timeoutError, response) => {
            if (timeoutError || !response?.success) {
              setError(
                response?.message || "Unable to delete connection."
              );
              return;
            }

            setEdges((currentEdges) =>
              currentEdges.filter((edge) => edge.id !== change.id)
            );

            setError(null);
            setSaveMessage("");
          }
        );
      });
    },
    [diagramId, roomStatus, setEdges]
  );

  // GET SELECTED NODE
  const selectedNode = nodes.find((node) => node.selected) || null;

  const updateSelectedNode = useCallback(
    (dataUpdates) => {
      if (!selectedNode) return;

      if (!socket.connected || roomStatus !== "joined") {
        setError("Not connected to the diagram room.");
        return;
      }

      const operationId = crypto.randomUUID();

      socket.timeout(5000).emit(
        "node:update",
        {
          diagramId,
          operationId,
          nodeId: selectedNode.id,
          updates: {
            data: dataUpdates,
          },
        },
        (timeoutError, response) => {
          if (timeoutError || !response?.success) {
            setError(response?.message || "Unable to update node.");
            return;
          }

          setNodes((currentNodes) =>
            currentNodes.map((node) =>
              node.id === selectedNode.id
                ? {
                  ...node,
                  data: {
                    ...node.data,
                    ...dataUpdates,
                  },
                }
                : node
            )
          );

          setError(null);
          setSaveMessage("");
        }
      );
    },
    [diagramId, roomStatus, selectedNode, setNodes]
  );

  // BROADCAST LOCAL CURSOR POSITION


  // CREATE CONNECTIONS

  // CREATE AND SYNCHRONIZE CONNECTIONS
  const onConnect = useCallback(
    (connection) => {
      if (!socket.connected || roomStatus !== "joined") {
        setError("Not connected to the diagram room.");
        return;
      }

      const edge = {
        ...connection,
        id: crypto.randomUUID(),
      };

      const operationId = crypto.randomUUID();

      socket.timeout(5000).emit(
        "edge:create",
        {
          diagramId,
          operationId,
          edge,
        },
        (timeoutError, response) => {
          if (timeoutError || !response?.success) {
            setError(
              response?.message || "Unable to create connection."
            );
            return;
          }

          setEdges((currentEdges) => {
            if (currentEdges.some((item) => item.id === edge.id)) {
              return currentEdges;
            }

            return [...currentEdges, response.edge || edge];
          });

          setError(null);
          setSaveMessage("");
        }
      );
    },
    [diagramId, roomStatus, setEdges]
  );


  // SAVE DIAGRAM TO POSTGRESQL
  async function handleSave() {
    try {
      setSaving(true);
      setSaveMessage("");
      setError(null);

      const response = await fetch(API.UPDATE_DIAGRAM(diagramId), {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nodes,
          edges,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to save diagram."
        );
      }

      setDiagram(result.data);
      setSaveMessage("All changes saved successfully.");
    } catch (err) {
      setError(err.message || "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  // LOADING SCREEN
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-600">Loading diagram...</p>
      </main>
    );
  }

  // ERROR SCREEN
  if (error && !diagram) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-6 text-center">
        <h1 className="text-xl font-semibold text-gray-900">
          Unable to open diagram
        </h1>

        <p className="max-w-md text-gray-600">{error}</p>

        <Link
          href="/workspace"
          className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white"
        >
          Back to workspace
        </Link>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-gray-50">

      {/* HEADER */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <Link
            href={`/diagrams/${diagramId}`}
            className="text-sm text-indigo-600"
          >
            Back to details
          </Link>

          <h1 className="mt-1 text-xl font-bold text-gray-900">
            {diagram?.title || "Untitled Diagram"}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">

          {/* SOCKET CONNECTION STATUS */}
          <div className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-green-500" : "bg-red-500"
                }`}
            />

            <span className="text-xs font-medium text-gray-600">
              {connected ? "Connected" : "Offline"}
            </span>
          </div>

          {/* DIAGRAM ROOM STATUS */}
          <div className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${roomStatus === "joined"
                ? "bg-green-500"
                : roomStatus === "rejected"
                  ? "bg-red-500"
                  : "bg-amber-500"
                }`}
            />

            <span className="text-xs font-medium text-gray-600">
              {roomStatus === "joined"
                ? "In diagram room"
                : roomStatus === "rejected"
                  ? "Access denied"
                  : roomStatus === "unavailable"
                    ? "Room service unavailable"
                    : "Joining room..."}
            </span>
          </div>
          {/* ACTIVE COLLABORATORS */}
          {collaborators.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {collaborators.map((user, index) => {
                  const colors = [
                    "bg-blue-500",
                    "bg-green-500",
                    "bg-purple-500",
                    "bg-orange-500",
                    "bg-pink-500",
                  ];

                  return (
                    <div
                      key={user.id}
                      title={user.name}
                      className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white ${colors[index % colors.length]
                        }`}
                    >
                      {user.name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                  );
                })}
              </div>

              <span className="text-xs text-gray-500">
                {collaborators.length} online
              </span>
            </div>
          )}
          {/* SAVE MESSAGE */}
          {saveMessage && (
            <span className="text-sm text-green-600">
              {saveMessage}
            </span>
          )}
          {/* SHARE BUTTON */}
          <button
            type="button"
            onClick={() => {
              setShareOpen(true);
              setShareMessage("");
              setShareError("");
            }}
            className="rounded-lg border border-indigo-200 bg-white px-5 py-2.5 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50"
          >
            Share
          </button>
          {/* SAVE BUTTON */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </header>
      {/* COLLABORATOR PRESENCE NOTIFICATION */}
      {presenceNotice && (
        <div className="flex items-center justify-between border-b border-indigo-200 bg-indigo-50 px-6 py-3">
          <p className="text-sm font-medium text-indigo-700">
            {presenceNotice}
          </p>

          <button
            type="button"
            onClick={() => setPresenceNotice("")}
            className="ml-4 text-indigo-500 hover:text-indigo-800"
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      )}
      {/* SHARE DIALOG */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">
                Share diagram
              </h2>

              <button
                type="button"
                onClick={() => setShareOpen(false)}
                className="text-2xl text-gray-400 hover:text-gray-700"
                aria-label="Close share dialog"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Collaborator email
                </label>

                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Permission
                </label>

                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-indigo-500"
                >
                  <option value="EDITOR">Editor — Can edit diagram</option>
                  <option value="VIEWER">Viewer — Can view diagram</option>
                </select>
              </div>

              {shareError && (
                <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                  {shareError}
                </p>
              )}

              {shareMessage && (
                <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
                  {shareMessage}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShareOpen(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={inviting}
                  className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {inviting ? "Inviting..." : "Send invitation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ERROR MESSAGE */}
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* SHAPE TOOLBAR */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-white px-5 py-3">
        <span className="mr-2 text-sm font-semibold text-gray-600">
          Shapes:
        </span>

        {[
          "rectangle",
          "rounded",
          "circle",
          "diamond",
          "parallelogram",
        ].map((shape) => (
          <button
            key={shape}
            type="button"
            onClick={() => addShape(shape)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm capitalize text-gray-700 hover:border-indigo-500 hover:bg-indigo-50"
          >
            + {shape}
          </button>

        ))}
        <button
          type="button"
          disabled={!nodes.some((node) => node.selected)}
          onClick={() => {
            const selectedNodes = nodes.filter((node) => node.selected);

            selectedNodes.forEach((node) => {
              handleNodesChange([
                { type: "remove", id: node.id },
              ]);
            });
          }}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete selected
        </button>
        <button
          type="button"
          disabled={!edges.some((edge) => edge.selected)}
          onClick={() => {
            const selectedEdges = edges.filter((edge) => edge.selected);

            handleEdgesChange(
              selectedEdges.map((edge) => ({
                type: "remove",
                id: edge.id,
              }))
            );
          }}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Delete selected edge
        </button>
      </div>

      {/* NODE PROPERTIES PANEL */}
      {selectedNode && (
        <div className="flex flex-wrap items-end gap-4 border-b border-gray-200 bg-white px-5 py-4">
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-gray-500">
              NODE LABEL
            </label>
            <input
              type="text"
              value={editingLabel}
              onChange={(e) => setEditingLabel(e.target.value)}
              onFocus={() => setEditingLabel(selectedNode.data.label || "")}
              placeholder="Enter node label"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">
              BACKGROUND
            </label>
            <input
              type="color"
              value={editingBackground}
              onChange={(e) => setEditingBackground(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded border border-gray-300"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">
              BORDER
            </label>
            <input
              type="color"
              value={editingBorderColor}
              onChange={(e) => setEditingBorderColor(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded border border-gray-300"
            />
          </div>

          <button
            type="button"
            onClick={() =>
              updateSelectedNode({
                label: editingLabel,
                background: editingBackground,
                borderColor: editingBorderColor,
              })
            }
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Apply changes
          </button>
        </div>
      )}

      {/* DIAGRAM CANVAS */}
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onInit={setReactFlowInstance}
          onMouseMove={handleCanvasMouseMove}
          nodeTypes={nodeTypes}
          onNodeDrag={onNodeDrag}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          edgesReconnectable
          deleteKeyCode={["Backspace", "Delete"]}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
          <ViewportPortal>
            {collaborators
              .filter((user) => remoteCursors[user.id])
              .map((user, index) => {
                const position = remoteCursors[user.id];

                const colors = [
                  "#2563eb",
                  "#16a34a",
                  "#9333ea",
                  "#ea580c",
                  "#db2777",
                ];

                const color = colors[index % colors.length];

                return (
                  <div
                    key={user.id}
                    style={{
                      position: "absolute",
                      left: position.x,
                      top: position.y,
                      pointerEvents: "none",
                      zIndex: 1000,
                    }}
                  >
                    <svg
                      width="20"
                      height="24"
                      viewBox="0 0 20 24"
                      fill={color}
                    >
                      <path d="M1 1L1 20L6 15L10 23L14 21L10 13L18 13Z" />
                    </svg>

                    <div
                      style={{
                        backgroundColor: color,
                        color: "white",
                        padding: "3px 8px",
                        borderRadius: "5px",
                        fontSize: "11px",
                        marginLeft: "12px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {user.name}
                    </div>
                  </div>
                );
              })}
          </ViewportPortal>
        </ReactFlow>
      </div>
    </main>
  );
}
