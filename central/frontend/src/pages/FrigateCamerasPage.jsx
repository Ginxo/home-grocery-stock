import React from "react";
import {
  PageSection,
  Title,
  Alert,
  Spinner,
  EmptyState,
  EmptyStateBody,
  Label,
  Button,
  Tooltip,
  Content,
} from "@patternfly/react-core";
import { Table, Thead, Tbody, Tr, Th, Td, TableText } from "@patternfly/react-table";
import RhUiPlayIcon from "@patternfly/react-icons/dist/esm/icons/rh-ui-play-icon";
import RhUiPauseCircleIcon from "@patternfly/react-icons/dist/esm/icons/rh-ui-pause-circle-icon";
import { usePollingJson } from "../hooks/usePollingJson";

const ENABLE_TOOLTIP =
  "Enable detection through the bridge (POST /api/detect/<camera>/on). Opens a bridge session and turns Frigate detection ON via MQTT.";
const DISABLE_TOOLTIP =
  "Disable detection through the bridge (POST /api/detect/<camera>/off). Closes the bridge session, syncs Grocy if needed, and turns Frigate detection OFF via MQTT.";

function CameraActionButton({ detectActive, camName, enabling, disabling, onToggle }) {
  if (!detectActive) {
    return (
      <Tooltip content={ENABLE_TOOLTIP}>
        <Button
          variant="primary"
          icon={<RhUiPlayIcon />}
          isLoading={enabling}
          isDisabled={enabling}
          onClick={() => onToggle(camName, "on")}
          aria-label={`Enable detection for ${camName} via bridge`}
        >
          Enable
        </Button>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={DISABLE_TOOLTIP}>
      <Button
        variant="danger"
        icon={<RhUiPauseCircleIcon />}
        isLoading={disabling}
        isDisabled={disabling}
        onClick={() => onToggle(camName, "off")}
        aria-label={`Disable detection for ${camName} via bridge`}
      >
        Disable
      </Button>
    </Tooltip>
  );
}

export default function FrigateCamerasPage() {
  const { data, error, loading } = usePollingJson("/api/frigate/cameras", 15000);
  const { data: bridgeState, error: bridgeStateError } = usePollingJson("/api/bridge/state", 3000);
  const cameras = data?.cameras || [];
  const [actionState, setActionState] = React.useState({});
  const [actionMessage, setActionMessage] = React.useState(null);

  function isDetectActive(cameraName) {
    return !!bridgeState?.cameras?.[cameraName]?.active;
  }

  async function toggleDetect(cameraName, state) {
    const key = `${cameraName}:${state}`;
    setActionState((prev) => ({ ...prev, [key]: true }));
    setActionMessage(null);
    try {
      const res = await fetch(`/api/bridge/detect/${encodeURIComponent(cameraName)}/${state}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      setActionMessage({
        variant: "success",
        title: `Detection ${state.toUpperCase()} on ${cameraName}`,
        text: body.message || "Request completed via bridge.",
      });
    } catch (err) {
      setActionMessage({
        variant: "danger",
        title: `Failed to set detection ${state} on ${cameraName}`,
        text: err.message || String(err),
      });
    } finally {
      setActionState((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Frigate Cameras</Title>
        <Content component="p">
          Camera definitions from frigate/config.yml. Enable/disable actions are sent through the
          bridge, not directly to Frigate.
        </Content>
      </PageSection>
      <PageSection>
        {actionMessage && (
          <Alert
            variant={actionMessage.variant}
            title={actionMessage.title}
            isInline
            timeout={8000}
            onTimeout={() => setActionMessage(null)}
            style={{ marginBottom: "1rem" }}
          >
            {actionMessage.text}
          </Alert>
        )}
        {bridgeStateError && (
          <Alert
            variant="warning"
            title="Bridge state unavailable"
            isInline
            style={{ marginBottom: "1rem" }}
          >
            {bridgeStateError}. Action buttons use bridge session state when available.
          </Alert>
        )}
        {loading && !data && <Spinner aria-label="Loading cameras" />}
        {error && (
          <Alert variant="danger" title="Failed to load Frigate config" isInline>
            {error}
          </Alert>
        )}
        {!loading && !error && cameras.length === 0 && (
          <EmptyState titleText="No cameras found" headingLevel="h2">
            <EmptyStateBody>The mounted frigate/config.yml has no camera entries.</EmptyStateBody>
          </EmptyState>
        )}
        {cameras.length > 0 && (
          <Table aria-label="Frigate cameras" variant="compact">
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Detect</Th>
                <Th>Resolution</Th>
                <Th>FPS</Th>
                <Th>Tracked objects</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {cameras.map((cam) => {
                const detectActive = isDetectActive(cam.name);
                const enabling = !!actionState[`${cam.name}:on`];
                const disabling = !!actionState[`${cam.name}:off`];
                return (
                  <Tr key={cam.name}>
                    <Td dataLabel="Name">{cam.name}</Td>
                    <Td dataLabel="Detect">
                      <Label color={detectActive ? "green" : "grey"}>
                        {detectActive ? "enabled" : "disabled"}
                      </Label>
                    </Td>
                    <Td dataLabel="Resolution">
                      {cam.detect?.width && cam.detect?.height
                        ? `${cam.detect.width}×${cam.detect.height}`
                        : "—"}
                    </Td>
                    <Td dataLabel="FPS">{cam.detect?.fps ?? "—"}</Td>
                    <Td dataLabel="Tracked objects">
                      {(cam.trackedObjects || []).join(", ") || "—"}
                    </Td>
                    <Td modifier="fitContent" hasAction>
                      <TableText>
                        <CameraActionButton
                          detectActive={detectActive}
                          camName={cam.name}
                          enabling={enabling}
                          disabling={disabling}
                          onToggle={toggleDetect}
                        />
                      </TableText>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
}
