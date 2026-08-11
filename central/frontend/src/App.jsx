import React from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import {
  Page,
  Masthead,
  MastheadMain,
  MastheadBrand,
  MastheadLogo,
  MastheadContent,
  MastheadToggle,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  Nav,
  NavList,
  NavItem,
  NavExpandable,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Title,
} from "@patternfly/react-core";
import RhUiMenuBarsIcon from "@patternfly/react-icons/dist/esm/icons/rh-ui-menu-bars-icon";
import DashboardPage from "./pages/DashboardPage";
import SwaggerPage from "./pages/SwaggerPage";
import FrigateCamerasPage from "./pages/FrigateCamerasPage";
import BridgeStatePage from "./pages/BridgeStatePage";
import BridgeLogsPage from "./pages/BridgeLogsPage";
import MqttLivePage from "./pages/MqttLivePage";

const TOP_NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/frigate", label: "Frigate Cameras" },
  { to: "/mqtt", label: "MQTT Live" },
];

const BRIDGE_NAV = [
  { to: "/bridge/api", label: "API" },
  { to: "/bridge/state", label: "State" },
  { to: "/bridge/logs", label: "Logs" },
];

function App() {
  const location = useLocation();
  const bridgeActive = location.pathname.startsWith("/bridge");

  const headerToolbar = (
    <Toolbar id="central-toolbar" isFullHeight>
      <ToolbarContent>
        <ToolbarItem>
          <Title headingLevel="h1" size="lg">
            Home Grocery Stock Central
          </Title>
        </ToolbarItem>
      </ToolbarContent>
    </Toolbar>
  );

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton variant="plain" aria-label="Global navigation" id="nav-toggle">
            <RhUiMenuBarsIcon />
          </PageToggleButton>
        </MastheadToggle>
        <MastheadBrand>
          <MastheadLogo href="/">HGS Central</MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>{headerToolbar}</MastheadContent>
    </Masthead>
  );

  const sidebar = (
    <PageSidebar id="central-sidebar">
      <PageSidebarBody>
        <Nav aria-label="Central navigation">
          <NavList>
            {TOP_NAV.map((item) => (
              <NavItem
                key={item.to}
                itemId={item.to}
                isActive={
                  item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)
                }
              >
                <NavLink to={item.to} end={item.end}>
                  {item.label}
                </NavLink>
              </NavItem>
            ))}
            <NavExpandable
              title="Bridge"
              groupId="bridge"
              isActive={bridgeActive}
              isExpanded={bridgeActive}
            >
              {BRIDGE_NAV.map((item) => (
                <NavItem key={item.to} itemId={item.to} isActive={location.pathname === item.to}>
                  <NavLink to={item.to}>{item.label}</NavLink>
                </NavItem>
              ))}
            </NavExpandable>
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page masthead={masthead} sidebar={sidebar} isManagedSidebar>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/frigate" element={<FrigateCamerasPage />} />
        <Route path="/mqtt" element={<MqttLivePage />} />
        <Route path="/bridge/api" element={<SwaggerPage />} />
        <Route path="/bridge/state" element={<BridgeStatePage />} />
        <Route path="/bridge/logs" element={<BridgeLogsPage />} />
        {/* Legacy paths */}
        <Route path="/swagger" element={<SwaggerPage />} />
        <Route path="/bridge-state" element={<BridgeStatePage />} />
        <Route path="/bridge-logs" element={<BridgeLogsPage />} />
      </Routes>
    </Page>
  );
}

export default App;
