"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import {
  Box,
  Paper,
  Typography,
  Grid,
  Divider,
  Card,
  CardContent,
  CardHeader,
  Tooltip,
  useTheme,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Chip,
  Slider,
  Fab,
} from "@mui/material"
import {
  Storage as StorageIcon,
  Cloud as CloudIcon,
  Language as LanguageIcon,
  Security as SecurityIcon,
  Computer as ComputerIcon,
  Close as CloseIcon,
  Info as InfoIcon,
  CenterFocusStrong as ResetViewIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
} from "@mui/icons-material"

// Define types for our AWS resources
interface AWSResource {
  properties: Record<string, any>
}

interface Instance extends AWSResource {
  instanceId: string
}

interface Subnet extends AWSResource {
  subnetId: string
  instances: Instance[]
}

interface SecurityGroup extends AWSResource {
  groupId: string
}

interface VPC extends AWSResource {
  vpcId: string
  subnets: Subnet[]
  securityGroups: SecurityGroup[]
}

interface S3Bucket extends AWSResource {
  name: string
  properties: Record<string, any>
}

export interface AWSArchitecture {
  vpcs: VPC[]
  s3Buckets: S3Bucket[]
}

// Define a type for the selected resource
type SelectedResource = {
  type: "vpc" | "subnet" | "securityGroup" | "instance" | "s3Bucket"
  id: string
  data: any
} | null

// Component for S3 Buckets
const S3BucketComponent: React.FC<{
  bucket: S3Bucket
  isSelected: boolean
  onClick: () => void
}> = ({ bucket, isSelected, onClick }) => {
  return (
    <Card
      variant="outlined"
      sx={{
        m: 1,
        width: 200,
        border: isSelected ? "2px solid #FF9900" : "1px solid #FF9900",
        borderRadius: 2,
        boxShadow: isSelected ? 3 : 0,
        cursor: "pointer",
        transition: "all 0.2s",
        "&:hover": {
          boxShadow: 2,
        },
      }}
      onClick={onClick}
    >
      <CardHeader
        avatar={<StorageIcon sx={{ color: "#FF9900" }} />}
        title={
          <Typography variant="subtitle2" fontWeight="bold">
            S3 Bucket
          </Typography>
        }
        sx={{
          bgcolor: isSelected ? "rgba(255, 153, 0, 0.2)" : "rgba(255, 153, 0, 0.1)",
          p: 1,
        }}
      />
      <CardContent sx={{ p: 1 }}>
        <Typography variant="body2" noWrap>
          {bucket.name || "Unnamed Bucket"}
        </Typography>
        <Typography variant="caption" color="textSecondary" noWrap>
          {bucket.properties?.Region || "No Region"}
        </Typography>
      </CardContent>
    </Card>
  )
}

// Component for EC2 Instances
const InstanceComponent: React.FC<{
  instance: Instance
  isSelected: boolean
  onClick: (e: React.MouseEvent) => void
}> = ({ instance, isSelected, onClick }) => {
  return (
    <Card
      variant="outlined"
      sx={{
        m: 1,
        width: 180,
        border: isSelected ? "2px solid #EC7211" : "1px solid #EC7211",
        borderRadius: 2,
        boxShadow: isSelected ? 3 : 0,
        cursor: "pointer",
        transition: "all 0.2s",
        "&:hover": {
          boxShadow: 2,
        },
      }}
      onClick={onClick}
    >
      <CardHeader
        avatar={<ComputerIcon sx={{ color: "#EC7211" }} />}
        title={
          <Typography variant="subtitle2" fontWeight="bold">
            EC2 Instance
          </Typography>
        }
        sx={{
          bgcolor: isSelected ? "rgba(236, 114, 17, 0.2)" : "rgba(236, 114, 17, 0.1)",
          p: 1,
        }}
      />
      <CardContent sx={{ p: 1 }}>
        <Tooltip title={instance.instanceId}>
          <Typography variant="body2" noWrap>
            {instance.instanceId || "Unnamed Instance"}
          </Typography>
        </Tooltip>
        <Typography variant="caption" color="textSecondary" noWrap>
          {instance.properties?.InstanceType || "No Type"}
        </Typography>
      </CardContent>
    </Card>
  )
}

// Component for Subnets
const SubnetComponent: React.FC<{
  subnet: Subnet
  isSelected: boolean
  onSelect: (resource: SelectedResource) => void
}> = ({ subnet, isSelected, onSelect }) => {
  return (
    <Card
      variant="outlined"
      sx={{
        m: 1,
        width: 220,
        border: isSelected ? "2px solid #7AA116" : "1px solid #7AA116",
        borderRadius: 2,
        boxShadow: isSelected ? 3 : 0,
        cursor: "pointer",
        transition: "all 0.2s",
        "&:hover": {
          boxShadow: 2,
        },
      }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect({
          type: "subnet",
          id: subnet.subnetId,
          data: subnet,
        })
      }}
    >
      <CardHeader
        avatar={<LanguageIcon sx={{ color: "#7AA116" }} />}
        title={
          <Typography variant="subtitle2" fontWeight="bold">
            Subnet
          </Typography>
        }
        sx={{
          bgcolor: isSelected ? "rgba(122, 161, 22, 0.2)" : "rgba(122, 161, 22, 0.1)",
          p: 1,
        }}
      />
      <CardContent sx={{ p: 1 }}>
        <Tooltip title={subnet.subnetId}>
          <Typography variant="body2" noWrap>
            {subnet.subnetId}
          </Typography>
        </Tooltip>
        <Typography variant="caption" color="textSecondary" noWrap>
          CIDR: {subnet.properties?.CidrBlock || "No CIDR"}
        </Typography>

        {subnet.instances.length > 0 && (
          <Box sx={{ mt: 1, pl: 1, borderLeft: "1px dashed #ccc" }}>
            <Typography variant="caption" color="textSecondary">
              Instances ({subnet.instances.length})
            </Typography>
            {subnet.instances.map((instance) => (
              <InstanceComponent
                key={instance.instanceId}
                instance={instance}
                isSelected={isSelected && subnet.instances.some((i) => i.instanceId === instance.instanceId)}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation()
                  onSelect({
                    type: "instance",
                    id: instance.instanceId,
                    data: instance,
                  })
                }}
              />
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

// Component for Security Groups
const SecurityGroupComponent: React.FC<{
  securityGroup: SecurityGroup
  isSelected: boolean
  onClick: (e: React.MouseEvent) => void
}> = ({ securityGroup, isSelected, onClick }) => {
  return (
    <Card
      variant="outlined"
      sx={{
        m: 1,
        width: 220,
        border: isSelected ? "2px solid #D13212" : "1px solid #D13212",
        borderRadius: 2,
        boxShadow: isSelected ? 3 : 0,
        cursor: "pointer",
        transition: "all 0.2s",
        "&:hover": {
          boxShadow: 2,
        },
      }}
      onClick={onClick}
    >
      <CardHeader
        avatar={<SecurityIcon sx={{ color: "#D13212" }} />}
        title={
          <Typography variant="subtitle2" fontWeight="bold">
            Security Group
          </Typography>
        }
        sx={{
          bgcolor: isSelected ? "rgba(209, 50, 18, 0.2)" : "rgba(209, 50, 18, 0.1)",
          p: 1,
        }}
      />
      <CardContent sx={{ p: 1 }}>
        <Tooltip title={securityGroup.groupId}>
          <Typography variant="body2" noWrap>
            {securityGroup.properties?.GroupName || "Unnamed Group"}
          </Typography>
        </Tooltip>
        <Typography variant="caption" color="textSecondary" noWrap>
          ID: {securityGroup.groupId}
        </Typography>
        <Typography variant="caption" color="textSecondary" display="block" noWrap>
          {securityGroup.properties?.Description || "No description"}
        </Typography>
      </CardContent>
    </Card>
  )
}

// Component for VPCs
const VPCComponent: React.FC<{
  vpc: VPC
  isSelected: boolean
  selectedResource: SelectedResource
  onSelect: (resource: SelectedResource) => void
}> = ({ vpc, isSelected, selectedResource, onSelect }) => {
  return (
    <Paper
      elevation={isSelected ? 4 : 2}
      sx={{
        mx: 0,
        mb: 3,
        p: 2,
        border: isSelected ? "3px solid #232F3E" : "2px solid #232F3E",
        borderRadius: 3,
        bgcolor: isSelected ? "rgba(35, 47, 62, 0.05)" : "rgba(35, 47, 62, 0.03)",
        cursor: "pointer",
        transition: "all 0.2s",
      }}
      onClick={() =>
        onSelect({
          type: "vpc",
          id: vpc.vpcId,
          data: vpc,
        })
      }
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <CloudIcon sx={{ color: "#232F3E", mr: 1 }} />
        <Typography variant="h6" fontWeight="bold">
          VPC: {vpc.vpcId}
        </Typography>
      </Box>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        CIDR: {vpc.properties?.CidrBlock || "No CIDR"}
      </Typography>

      <Divider sx={{ my: 2 }} />

      {vpc.subnets.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
            Subnets ({vpc.subnets.length})
          </Typography>
          <Grid container spacing={2}>
            {vpc.subnets.map((subnet) => (
              <Grid item key={subnet.subnetId}>
                <SubnetComponent
                  subnet={subnet}
                  isSelected={selectedResource?.type === "subnet" && selectedResource.id === subnet.subnetId}
                  onSelect={onSelect}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {vpc.securityGroups.length > 0 && (
        <Box>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
            Security Groups ({vpc.securityGroups.length})
          </Typography>
          <Grid container spacing={2}>
            {vpc.securityGroups.map((securityGroup) => (
              <Grid item key={securityGroup.groupId}>
                <SecurityGroupComponent
                  securityGroup={securityGroup}
                  isSelected={
                    selectedResource?.type === "securityGroup" && selectedResource.id === securityGroup.groupId
                  }
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    onSelect({
                      type: "securityGroup",
                      id: securityGroup.groupId,
                      data: securityGroup,
                    })
                  }}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Paper>
  )
}

// Details Panel Component
const ResourceDetailsPanel: React.FC<{
  selectedResource: SelectedResource
  onClose: () => void
}> = ({ selectedResource, onClose }) => {
  if (!selectedResource) return null

  const getTitle = () => {
    switch (selectedResource.type) {
      case "vpc":
        return `VPC: ${selectedResource.data.vpcId}`
      case "subnet":
        return `Subnet: ${selectedResource.data.subnetId}`
      case "securityGroup":
        return `Security Group: ${selectedResource.data.properties?.GroupName || selectedResource.data.groupId}`
      case "instance":
        return `Instance: ${selectedResource.data.instanceId}`
      case "s3Bucket":
        return `S3 Bucket: ${selectedResource.data.name}`
      default:
        return "Resource Details"
    }
  }

  const getIcon = () => {
    switch (selectedResource.type) {
      case "vpc":
        return <CloudIcon sx={{ color: "#232F3E" }} />
      case "subnet":
        return <LanguageIcon sx={{ color: "#7AA116" }} />
      case "securityGroup":
        return <SecurityIcon sx={{ color: "#D13212" }} />
      case "instance":
        return <ComputerIcon sx={{ color: "#EC7211" }} />
      case "s3Bucket":
        return <StorageIcon sx={{ color: "#FF9900" }} />
      default:
        return <InfoIcon />
    }
  }

  // Format the properties for display
  const formatProperties = () => {
    const properties = selectedResource.data.properties || {}
    return Object.entries(properties).map(([key, value]) => ({
      key,
      value: typeof value === "object" ? JSON.stringify(value) : String(value),
    }))
  }

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        p: 2,
        bgcolor: "background.paper",
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          {getIcon()}
          <Typography variant="h6" sx={{ ml: 1 }}>
            {getTitle()}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      <Divider sx={{ mb: 2 }} />

      <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
        Resource ID
      </Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        {selectedResource.id}
      </Typography>

      <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
        Resource Type
      </Typography>
      <Chip label={selectedResource.type.toUpperCase()} size="small" sx={{ mb: 2 }} />

      <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
        Properties
      </Typography>
      <List dense>
        {formatProperties().map((prop, index) => (
          <ListItem key={index} divider>
            <ListItemText
              primary={prop.key}
              secondary={prop.value}
              primaryTypographyProps={{ fontWeight: "medium" }}
              secondaryTypographyProps={{
                sx: {
                  wordBreak: "break-all",
                  whiteSpace: "normal",
                },
              }}
            />
          </ListItem>
        ))}
      </List>

      {/* Additional resource-specific details */}
      {selectedResource.type === "vpc" && (
        <>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mt: 2 }}>
            Summary
          </Typography>
          <List dense>
            <ListItem divider>
              <ListItemText primary="Subnets" secondary={selectedResource.data.subnets.length} />
            </ListItem>
            <ListItem divider>
              <ListItemText primary="Security Groups" secondary={selectedResource.data.securityGroups.length} />
            </ListItem>
          </List>
        </>
      )}

      {selectedResource.type === "subnet" && (
        <>
          <Typography variant="subtitle1" fontWeight="bold" sx={{ mt: 2 }}>
            Summary
          </Typography>
          <List dense>
            <ListItem divider>
              <ListItemText primary="Instances" secondary={selectedResource.data.instances.length} />
            </ListItem>
            <ListItem divider>
              <ListItemText primary="VPC ID" secondary={selectedResource.data.properties?.VpcId} />
            </ListItem>
          </List>
        </>
      )}
    </Box>
  )
}

// Zoom and Pan Controls
const CanvasControls: React.FC<{
  zoom: number
  setZoom: (zoom: number) => void
  resetView: () => void
}> = ({ zoom, setZoom, resetView }) => {
  const handleZoomChange = (_event: Event, newValue: number | number[]) => {
    setZoom(newValue as number)
  }

  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 20,
        left: 20,
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        opacity: 0.7,
        transition: "opacity 0.2s",
        "&:hover": {
          opacity: 1,
        },
      }}
    >
      <Fab
        size="small"
        onClick={resetView}
        title="Reset View"
        sx={{
          bgcolor: "rgba(255, 255, 255, 0.8)",
          color: "#555",
          boxShadow: 1,
          "&:hover": {
            bgcolor: "rgba(255, 255, 255, 0.95)",
          },
        }}
      >
        <ResetViewIcon />
      </Fab>
      <Paper
        elevation={1}
        sx={{
          p: 1,
          borderRadius: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 40,
          bgcolor: "rgba(255, 255, 255, 0.8)",
        }}
      >
        <IconButton
          size="small"
          onClick={() => setZoom(Math.min(zoom + 0.1, 2))}
          title="Zoom In"
          sx={{ color: "#555" }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
        <Slider
          orientation="vertical"
          value={zoom}
          min={0.5}
          max={2}
          step={0.1}
          onChange={handleZoomChange}
          sx={{
            height: 80,
            my: 1,
            "& .MuiSlider-thumb": {
              width: 12,
              height: 12,
            },
            "& .MuiSlider-track": {
              width: 2,
            },
            "& .MuiSlider-rail": {
              width: 2,
            },
          }}
          aria-label="Zoom"
        />
        <IconButton
          size="small"
          onClick={() => setZoom(Math.max(zoom - 0.1, 0.5))}
          title="Zoom Out"
          sx={{ color: "#555" }}
        >
          <RemoveIcon fontSize="small" />
        </IconButton>
      </Paper>
    </Box>
  )
}

// Main component
const AWSArchitectureVisualizer: React.FC<{
  data: AWSArchitecture
  height?: string | number
  width?: string | number
}> = ({ data, height = "600px", width = "100%" }) => {
  const theme = useTheme()
  const [selectedResource, setSelectedResource] = useState<SelectedResource>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  // Canvas state
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  // Calculate drawer width - 30% of container width but max 350px
  const drawerWidth = 350

  // Handle resource selection
  const handleSelectResource = (resource: SelectedResource) => {
    setSelectedResource(resource)
    setDetailsOpen(true)
  }

  // Handle closing the details panel
  const handleCloseDetails = () => {
    setDetailsOpen(false)
    setTimeout(() => {
      setSelectedResource(null)
    }, 300)
  }

  // Reset view to default position and zoom
  const resetView = () => {
    setPosition({ x: 0, y: 0 })
    setZoom(1)
  }

  // Handle mouse down for dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // Only left mouse button
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
  }

  // Handle mouse move for dragging
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - dragStart.x
      const dy = e.clientY - dragStart.y
      setPosition((prev) => ({ x: prev.x + dx, y: prev.y + dy }))
      setDragStart({ x: e.clientX, y: e.clientY })
    },
    [isDragging, dragStart],
  )

  // Handle mouse up to stop dragging
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Handle wheel for zooming
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    setZoom((prev) => Math.max(0.5, Math.min(2, prev + delta)))
  }

  // Add and remove event listeners
  useEffect(() => {
    const currentCanvas = canvasRef.current
    if (!currentCanvas) return

    const handleMouseMoveWrapper = (e: MouseEvent) => {
      if (isDragging) handleMouseMove(e)
    }

    const handleMouseUpWrapper = () => {
      if (isDragging) handleMouseUp()
    }

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMoveWrapper)
      window.addEventListener("mouseup", handleMouseUpWrapper)
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMoveWrapper)
      window.removeEventListener("mouseup", handleMouseUpWrapper)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  if (!data || (data.vpcs.length === 0 && data.s3Buckets.length === 0)) {
    return (
      <Box sx={{ p: 4, textAlign: "center", height, width }}>
        <Typography variant="h5" color="text.secondary">
          No AWS resources found in the provided data.
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
          Please check your data structure and ensure it contains VPCs or S3 buckets.
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        width,
        height,
        overflow: "hidden",
        position: "relative",
        bgcolor: "#f0f2f5",
        cursor: isDragging ? "grabbing" : "grab",
        borderRadius: 2,
        border: "1px solid #ddd",
      }}
    >
      {/* Header - Now positioned relative to the container */}
      <Box
        sx={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          textShadow: "0px 0px 2px rgba(255, 255, 255, 0.8)",
        }}
      >
        <Typography variant="h5" sx={{ color: "#232F3E", fontWeight: "bold" }}>
          AWS Architecture Visualization
        </Typography>
        <Typography variant="h6" sx={{ color: "#232F3E", mt: 0.5 }}>
          Virtual Private Clouds ({data.vpcs.length})
        </Typography>
      </Box>

      {/* Canvas with zoom and pan */}
      <Box
        ref={canvasRef}
        sx={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          position: "relative",
        }}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
      >
        <Box
          sx={{
            position: "absolute",
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            transformOrigin: "center",
            transition: "transform 0.1s ease-out",
            padding: 4,
            paddingTop: 12, // Extra padding at top to account for header
            minWidth: "100%",
            minHeight: "100%",
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {/* VPCs Section - Title is now in the header */}
            {data.vpcs.map((vpc) => (
              <VPCComponent
                key={vpc.vpcId}
                vpc={vpc}
                isSelected={selectedResource?.type === "vpc" && selectedResource.id === vpc.vpcId}
                selectedResource={selectedResource}
                onSelect={handleSelectResource}
              />
            ))}

            {/* S3 Buckets Section */}
            {data.s3Buckets.length > 0 && (
              <Box>
                <Typography variant="h5" gutterBottom sx={{ color: "#232F3E" }}>
                  S3 Buckets ({data.s3Buckets.length})
                </Typography>
                <Grid container spacing={2}>
                  {data.s3Buckets.map((bucket, index) => (
                    <Grid item key={index}>
                      <S3BucketComponent
                        bucket={bucket}
                        isSelected={selectedResource?.type === "s3Bucket" && selectedResource.id === bucket.name}
                        onClick={() =>
                          handleSelectResource({
                            type: "s3Bucket",
                            id: bucket.name,
                            data: bucket,
                          })
                        }
                      />
                    </Grid>
                  ))}
                </Grid>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Zoom and Pan Controls */}
      <CanvasControls zoom={zoom} setZoom={setZoom} resetView={resetView} />

      {/* Details Panel - Right Side Drawer */}
      <Box
        sx={{
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: detailsOpen ? drawerWidth : 0,
          transition: "width 0.3s ease-in-out",
          overflow: "hidden",
          boxShadow: detailsOpen ? "-4px 0 8px rgba(0, 0, 0, 0.1)" : "none",
          bgcolor: "background.paper",
          zIndex: 20,
        }}
      >
        {selectedResource && <ResourceDetailsPanel selectedResource={selectedResource} onClose={handleCloseDetails} />}
      </Box>
    </Box>
  )
}

export default AWSArchitectureVisualizer

