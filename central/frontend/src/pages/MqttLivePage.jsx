import React from "react";
import {
  PageSection,
  Title,
  Alert,
  EmptyState,
  EmptyStateBody,
  Content,
  Label,
} from "@patternfly/react-core";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table";
import { io } from "socket.io-client";

const MAX_ROWS = 200;

function truncate(text, max = 200) {
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function MqttLivePage() {
  const [messages, setMessages] = React.useState([]);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    const socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("connect_error", (err) => {
      setError(err.message || "Socket connection failed");
      setConnected(false);
    });

    socket.on("mqtt:history", (history) => {
      const list = Array.isArray(history) ? history.slice().reverse() : [];
      setMessages(list.slice(0, MAX_ROWS));
    });

    socket.on("mqtt:message", (entry) => {
      setMessages((prev) => [entry, ...prev].slice(0, MAX_ROWS));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">MQTT Live</Title>
        <Content component="p">
          Real-time Mosquitto traffic (topic #) via the central BFF.{" "}
          <Label color={connected ? "green" : "orange"}>
            {connected ? "connected" : "disconnected"}
          </Label>
        </Content>
      </PageSection>
      <PageSection>
        {error && (
          <Alert variant="danger" title="Socket.IO error" isInline>
            {error}
          </Alert>
        )}
        {!error && messages.length === 0 && (
          <EmptyState titleText="Waiting for MQTT messages" headingLevel="h2">
            <EmptyStateBody>
              Messages published on the local Mosquitto broker will appear here.
            </EmptyStateBody>
          </EmptyState>
        )}
        {messages.length > 0 && (
          <Table aria-label="MQTT messages" variant="compact">
            <Thead>
              <Tr>
                <Th width={20}>Timestamp</Th>
                <Th width={30}>Topic</Th>
                <Th>Payload</Th>
              </Tr>
            </Thead>
            <Tbody>
              {messages.map((msg, idx) => (
                <Tr key={`${msg.timestamp}-${msg.topic}-${idx}`}>
                  <Td dataLabel="Timestamp">
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "—"}
                  </Td>
                  <Td dataLabel="Topic">
                    <code>{msg.topic}</code>
                  </Td>
                  <Td dataLabel="Payload">
                    <code>{truncate(msg.payload)}</code>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
}
