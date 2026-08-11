import React, { useMemo, useState } from "react";
import {
  PageSection,
  Title,
  Alert,
  Spinner,
  EmptyState,
  EmptyStateBody,
  Label,
  Content,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  Badge,
  Button,
} from "@patternfly/react-core";
import { Table, Thead, Tbody, Tr, Th, Td } from "@patternfly/react-table";
import { usePollingJson } from "../hooks/usePollingJson";

const LEVEL_OPTIONS = ["debug", "info", "success", "error"];
const NO_CAMERA = "(none)";

function levelColor(level) {
  switch (level) {
    case "success":
      return "green";
    case "error":
      return "red";
    case "debug":
      return "grey";
    default:
      return "blue";
  }
}

function cameraKey(camera) {
  return camera || NO_CAMERA;
}

function MultiFilterSelect({
  id,
  label,
  options,
  selected,
  onChange,
  placeholder,
}) {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = (toggleRef) => (
    <MenuToggle
      ref={toggleRef}
      onClick={() => setIsOpen(!isOpen)}
      isExpanded={isOpen}
      style={{ width: "200px" }}
    >
      {placeholder}
      {selected.length > 0 && <Badge isRead>{selected.length}</Badge>}
    </MenuToggle>
  );

  return (
    <Select
      role="menu"
      id={id}
      isOpen={isOpen}
      selected={selected}
      onSelect={(_event, value) => {
        if (selected.includes(value)) {
          onChange(selected.filter((item) => item !== value));
        } else {
          onChange([...selected, value]);
        }
      }}
      onOpenChange={(nextOpen) => setIsOpen(nextOpen)}
      toggle={toggle}
      aria-label={label}
    >
      <SelectList>
        {options.map((option) => (
          <SelectOption
            key={option}
            hasCheckbox
            value={option}
            isSelected={selected.includes(option)}
          >
            {option}
          </SelectOption>
        ))}
      </SelectList>
    </Select>
  );
}

export default function BridgeLogsPage() {
  const { data, error, loading } = usePollingJson("/api/bridge/logs", 5000);
  const logs = data?.logs || [];

  const [selectedLevels, setSelectedLevels] = useState([]);
  const [selectedCameras, setSelectedCameras] = useState([]);
  const [activeSortIndex, setActiveSortIndex] = useState(0);
  const [activeSortDirection, setActiveSortDirection] = useState("desc");

  const cameraOptions = useMemo(() => {
    const names = new Set();
    for (const entry of logs) {
      names.add(cameraKey(entry.camera));
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      const level = entry.level || "info";
      if (selectedLevels.length > 0 && !selectedLevels.includes(level)) {
        return false;
      }
      if (
        selectedCameras.length > 0 &&
        !selectedCameras.includes(cameraKey(entry.camera))
      ) {
        return false;
      }
      return true;
    });
  }, [logs, selectedLevels, selectedCameras]);

  const sortedLogs = useMemo(() => {
    const getValue = (entry) => {
      switch (activeSortIndex) {
        case 0:
          return entry.timestamp || "";
        case 1:
          return entry.level || "info";
        case 2:
          return cameraKey(entry.camera);
        case 3:
          return entry.message || "";
        default:
          return "";
      }
    };

    return [...filteredLogs].sort((a, b) => {
      const aValue = getValue(a);
      const bValue = getValue(b);
      if (aValue === bValue) {
        return 0;
      }
      if (activeSortDirection === "asc") {
        return aValue > bValue ? 1 : -1;
      }
      return aValue > bValue ? -1 : 1;
    });
  }, [filteredLogs, activeSortIndex, activeSortDirection]);

  const getSortParams = (columnIndex) => ({
    sortBy: {
      index: activeSortIndex,
      direction: activeSortDirection,
    },
    onSort: (_event, index, direction) => {
      setActiveSortIndex(index);
      setActiveSortDirection(direction);
    },
    columnIndex,
  });

  const hasFilters = selectedLevels.length > 0 || selectedCameras.length > 0;
  const clearFilters = () => {
    setSelectedLevels([]);
    setSelectedCameras([]);
  };

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Bridge Logs</Title>
        <Content component="p">
          Recent bridge events (polled every 5s). Filter by level and camera;
          click column headers to sort.
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
          <>
            <Toolbar id="bridge-logs-toolbar" clearAllFilters={clearFilters}>
              <ToolbarContent>
                <ToolbarGroup variant="filter-group">
                  <ToolbarItem>
                    <MultiFilterSelect
                      id="bridge-logs-level-filter"
                      label="Filter by level"
                      placeholder="Level"
                      options={LEVEL_OPTIONS}
                      selected={selectedLevels}
                      onChange={setSelectedLevels}
                    />
                  </ToolbarItem>
                  <ToolbarItem>
                    <MultiFilterSelect
                      id="bridge-logs-camera-filter"
                      label="Filter by camera"
                      placeholder="Camera"
                      options={cameraOptions}
                      selected={selectedCameras}
                      onChange={setSelectedCameras}
                    />
                  </ToolbarItem>
                </ToolbarGroup>
                {hasFilters && (
                  <ToolbarItem>
                    <Button variant="link" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  </ToolbarItem>
                )}
              </ToolbarContent>
            </Toolbar>
            {sortedLogs.length === 0 ? (
              <EmptyState titleText="No matching logs" headingLevel="h2">
                <EmptyStateBody>
                  No events match the selected filters.
                </EmptyStateBody>
              </EmptyState>
            ) : (
              <Table aria-label="Bridge logs" variant="compact">
                <Thead>
                  <Tr>
                    <Th width={20} sort={getSortParams(0)}>
                      Timestamp
                    </Th>
                    <Th width={10} sort={getSortParams(1)}>
                      Level
                    </Th>
                    <Th width={15} sort={getSortParams(2)}>
                      Camera
                    </Th>
                    <Th sort={getSortParams(3)}>Message</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {sortedLogs.map((entry, idx) => (
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
          </>
        )}
      </PageSection>
    </>
  );
}
