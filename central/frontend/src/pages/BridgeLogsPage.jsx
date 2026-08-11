import React from "react";
import {
  PageSection,
  Title,
  Alert,
  Spinner,
  EmptyState,
  EmptyStateBody,
  Label,
  Content,
} from "@patternfly/react-core";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table";
import { usePollingJson } from "../hooks/usePollingJson";

function levelColor(level) {
  switch (level) {
    case "success":
      return "green";
    case "error":
      return "red";
    default:
      return "blue";
  }
}

export default function BridgeLogsPage() {
  const { data, error, loading } = usePollingJson("/api/bridge/logs", 5000);
  const logs = data?.logs || [];

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Bridge Logs</Title>
        <Content component="p">
          Recent success and error events from bridge (polled every 5s, newest
          first).
        </Content>
      </PageSection>
      <PageSection>
        {loading && !data && <Spinner aria-label="Loading bridge logs" />}
        {error && (
          <Alert variant="danger" title="Failed to load bridge logs" isInline>
            {error}
          </Alert>
        )}
        {!loading && !error && logs.length === 0 && (
          <EmptyState titleText="No log events yet" headingLevel="h2">
            <EmptyStateBody>
              Bridge has not recorded any structured events in this process
              lifetime.
            </EmptyStateBody>
          </EmptyState>
        )}
        {logs.length > 0 && (
          <Table aria-label="Bridge logs" variant="compact">
            <Thead>
              <Tr>
                <Th width={20}>Timestamp</Th>
                <Th width={10}>Level</Th>
                <Th width={15}>Camera</Th>
                <Th>Message</Th>
              </Tr>
            </Thead>
            <Tbody>
              {logs.map((entry, idx) => (
                <Tr key={`${entry.timestamp}-${idx}`}>
                  <Td dataLabel="Timestamp">
                    {entry.timestamp
                      ? new Date(entry.timestamp).toLocaleString()
                      : "—"}
                  </Td>
                  <Td dataLabel="Level">
                    <Label color={levelColor(entry.level)}>
                      {entry.level || "info"}
                    </Label>
                  </Td>
                  <Td dataLabel="Camera">{entry.camera || "—"}</Td>
                  <Td dataLabel="Message">{entry.message}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
}
