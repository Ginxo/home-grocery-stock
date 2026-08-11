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

export default function BridgeStatePage() {
  const { data, error, loading } = usePollingJson("/api/bridge/state", 3000);
  const cameras = data?.cameras
    ? Object.entries(data.cameras).map(([name, state]) => ({ name, ...state }))
    : [];

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Bridge State</Title>
        <Content component="p">Live session state per camera (polled every 3s).</Content>
      </PageSection>
      <PageSection>
        {loading && !data && <Spinner aria-label="Loading bridge state" />}
        {error && (
          <Alert variant="danger" title="Failed to load bridge state" isInline>
            {error}
          </Alert>
        )}
        {!loading && !error && cameras.length === 0 && (
          <EmptyState titleText="No camera sessions yet" headingLevel="h2">
            <EmptyStateBody>
              Bridge has not seen any cameras. Trigger detection via POST
              /api/detect/&lt;camera&gt;/on to create a session.
            </EmptyStateBody>
          </EmptyState>
        )}
        {cameras.length > 0 && (
          <Table aria-label="Bridge camera state" variant="compact">
            <Thead>
              <Tr>
                <Th>Camera</Th>
                <Th>Session</Th>
                <Th>Active objects</Th>
                <Th>Session changes</Th>
              </Tr>
            </Thead>
            <Tbody>
              {cameras.map((cam) => (
                <Tr key={cam.name}>
                  <Td dataLabel="Camera">{cam.name}</Td>
                  <Td dataLabel="Session">
                    <Label color={cam.active ? "green" : "grey"}>
                      {cam.active ? "active" : "idle"}
                    </Label>
                  </Td>
                  <Td dataLabel="Active objects">{cam.active_objects_count ?? 0}</Td>
                  <Td dataLabel="Session changes">
                    {cam.session_changes && Object.keys(cam.session_changes).length > 0
                      ? Object.entries(cam.session_changes)
                          .map(([label, count]) => `${label}: ${count}`)
                          .join(", ")
                      : "—"}
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
