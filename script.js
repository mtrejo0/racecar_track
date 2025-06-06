// Barrier class for better organization
class Barrier {
    constructor(position, rotation, length) {
        this.height = 5;
        this.width = 2;
        this.length = length;
        this.mass = 10;
        this.friction = 0.8;
        this.velocity = { x: 0, z: 0 };
        
        // Create the 3D mesh
        this.geometry = new THREE.BoxGeometry(this.width, this.height, this.length);
        this.material = new THREE.MeshLambertMaterial({ color: 0xff0000 });
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        
        // Set position and rotation
        this.mesh.position.copy(position);
        this.mesh.rotation.y = rotation;
        this.mesh.castShadow = true;
        
        // Add physics properties
        this.mesh.userData = {
            isBarrier: true,
            barrier: this // Reference back to this barrier instance
        };
    }
    
    // Add to scene
    addToScene(parent) {
        parent.add(this.mesh);
    }
    
    // Update physics
    updatePhysics() {
        // Apply velocity to position
        this.mesh.position.x += this.velocity.x;
        this.mesh.position.z += this.velocity.z;
        
        // Apply friction to slow down
        this.velocity.x *= this.friction;
        this.velocity.z *= this.friction;
        
        // Stop very slow movement
        if (Math.abs(this.velocity.x) < 0.01) this.velocity.x = 0;
        if (Math.abs(this.velocity.z) < 0.01) this.velocity.z = 0;
        
        // Prevent sinking into ground
        if (this.mesh.position.y < this.height / 2) {
            this.mesh.position.y = this.height / 2;
        }
    }
    
    // Handle collision with car
    handleCollision(carPosition, carSpeed, carRotation) {
        // Calculate collision direction
        const carCenter = new THREE.Vector3(carPosition.x, carPosition.y, carPosition.z);
        const barrierCenter = this.mesh.position.clone();
        
        // Get collision direction (from barrier to car)
        const collisionDirection = new THREE.Vector3()
            .subVectors(carCenter, barrierCenter)
            .normalize();
        
        // If direction is invalid (objects at same position), use a random direction
        if (collisionDirection.length() === 0) {
            collisionDirection.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        }
        
        // Calculate minimum separation distance (smaller collision boxes)
        const carRadius = 6; // Reduced from 8 to 6
        const barrierRadius = Math.max(this.width, this.length) / 2 * 0.8; // 80% of actual size
        const minSeparation = carRadius + barrierRadius + 1; // Reduced buffer from 2 to 1
        
        // Current distance between objects
        const currentDistance = carCenter.distanceTo(barrierCenter);
        
        // If objects are overlapping, separate them
        if (currentDistance < minSeparation) {
            const separationNeeded = minSeparation - currentDistance;
            const separationVector = collisionDirection.clone().multiplyScalar(separationNeeded);
            
            // Move barrier away from car
            this.mesh.position.x -= separationVector.x * 0.6; // Barrier moves 60%
            this.mesh.position.z -= separationVector.z * 0.6;
            
            // Move car away from barrier (return this for car movement)
            const carSeparation = separationVector.clone().multiplyScalar(0.4); // Car moves 40%
            
            // Car impact force based on speed
            const impactForce = Math.abs(carSpeed) * 0.5;
            
            // Push barrier away with impact force
            const pushForce = collisionDirection.clone().multiplyScalar(-impactForce * 0.4);
            this.velocity.x += pushForce.x;
            this.velocity.z += pushForce.z;
            
            // Add some rotation to the barrier for realism
            this.mesh.rotation.y += (Math.random() - 0.5) * 0.3;
            
            // Return collision result with separation
            return {
                bounceForce: carSeparation,
                speedReduction: 0.4, // Lose 60% of speed
                separated: true
            };
        }
        
        // Normal collision without overlap
        const impactForce = Math.abs(carSpeed) * 0.5;
        
        // Push barrier away
        const pushForce = collisionDirection.clone().multiplyScalar(-impactForce * 0.3);
        this.velocity.x += pushForce.x;
        this.velocity.z += pushForce.z;
        
        // Add some rotation to the barrier for realism
        this.mesh.rotation.y += (Math.random() - 0.5) * 0.2;
        
        // Return bounce force for the car
        const bounceForce = collisionDirection.clone().multiplyScalar(impactForce * 0.1);
        return {
            bounceForce: bounceForce,
            speedReduction: 0.3, // Lose 70% of speed
            separated: false
        };
    }
    
    // Get bounding box for collision detection (smaller than visual)
    getBoundingBox() {
        const box = new THREE.Box3().setFromObject(this.mesh);
        // Shrink the bounding box by 20% on all sides
        const shrinkFactor = 0.8;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).multiplyScalar(shrinkFactor);
        
        box.setFromCenterAndSize(center, size);
        return box;
    }
    
    // Check if should be created at this radius
    static shouldCreateAtRadius(currentRadius, radiusThreshold = 520) {
        return currentRadius > radiusThreshold;
    }
}

// Global variables
let scene, camera, renderer, car, track;
let carPosition = { x: 0, y: 0, z: 500 }; // Start on the larger track
let carRotation = 0;
let carSpeed = 0;
let maxSpeed = 50;
let acceleration = 0.8; // Increased for logarithmic feel
let deceleration = 0.3;
let turnSpeed = 0.05;
let isFirstPerson = false;
let thirdPersonCamera, firstPersonCamera;

// Track waypoints for the racing line
let trackWaypoints = [];
let trackRadius = 500; // Increased base radius
let trackWidth = 120; // Increased track width from 80 to 120

// Collision detection
let barriers = []; // Store Barrier instances
let carBoundingBox = new THREE.Box3();

// Input handling
let keys = {
    up: false,
    down: false,
    left: false,
    right: false,
    space: false
};

function setup() {
    createCanvas(windowWidth, windowHeight, WEBGL);
    
    // Initialize Three.js
    initThreeJS();
    createGround(); // Add grass ground
    createCar();
    
    // Generate track waypoints FIRST
    generateTrackWaypoints();
    
    // Then create track using the waypoints
    createTrack();
    setupCameras();
    
    // Position car at first waypoint to ensure it starts on track
    if (trackWaypoints.length > 0) {
        const startWaypoint = trackWaypoints[0];
        carPosition.x = startWaypoint.x;
        carPosition.z = startWaypoint.z;
        carPosition.y = 0;
        
        // Set car rotation to face along the track
        carRotation = startWaypoint.angle;
        
        // Update car mesh position
        car.position.set(carPosition.x, carPosition.y, carPosition.z);
        car.rotation.y = carRotation;
    }
}

function initThreeJS() {
    // Create Three.js scene
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, 500, 2000);
    
    // Create renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas });
    renderer.setSize(windowWidth, windowHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Add lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 200, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);
    
    // Add sky
    const skyGeometry = new THREE.SphereGeometry(1500, 32, 32);
    const skyMaterial = new THREE.MeshBasicMaterial({
        color: 0x87CEEB,
        side: THREE.BackSide
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(sky);
}

function createGround() {
    // Create large grass ground
    const groundGeometry = new THREE.PlaneGeometry(2000, 2000);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 }); // Forest green
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    ground.receiveShadow = true;
    scene.add(ground);
}

function createCar() {
    car = new THREE.Group();
    
    // Main body (red)
    const bodyGeometry = new THREE.BoxGeometry(8, 2, 16);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 1;
    body.castShadow = true;
    car.add(body);
    
    // Cockpit
    const cockpitGeometry = new THREE.BoxGeometry(4, 1.5, 6);
    const cockpitMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial);
    cockpit.position.set(0, 2.5, -2);
    cockpit.castShadow = true;
    car.add(cockpit);
    
    // Front wing
    const frontWingGeometry = new THREE.BoxGeometry(12, 0.5, 2);
    const frontWingMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const frontWing = new THREE.Mesh(frontWingGeometry, frontWingMaterial);
    frontWing.position.set(0, 0.5, 8);
    frontWing.castShadow = true;
    car.add(frontWing);
    
    // Rear wing
    const rearWingGeometry = new THREE.BoxGeometry(8, 3, 1);
    const rearWingMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 });
    const rearWing = new THREE.Mesh(rearWingGeometry, rearWingMaterial);
    rearWing.position.set(0, 3, -8);
    rearWing.castShadow = true;
    car.add(rearWing);
    
    // Wheels (black)
    const wheelGeometry = new THREE.CylinderGeometry(2, 2, 1.5, 16);
    const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
    
    // Front wheels
    const frontLeftWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    frontLeftWheel.position.set(-5, 0, 5);
    frontLeftWheel.rotation.z = Math.PI / 2;
    frontLeftWheel.castShadow = true;
    car.add(frontLeftWheel);
    
    const frontRightWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    frontRightWheel.position.set(5, 0, 5);
    frontRightWheel.rotation.z = Math.PI / 2;
    frontRightWheel.castShadow = true;
    car.add(frontRightWheel);
    
    // Rear wheels
    const rearLeftWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    rearLeftWheel.position.set(-5, 0, -5);
    rearLeftWheel.rotation.z = Math.PI / 2;
    rearLeftWheel.castShadow = true;
    car.add(rearLeftWheel);
    
    const rearRightWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    rearRightWheel.position.set(5, 0, -5);
    rearRightWheel.rotation.z = Math.PI / 2;
    rearRightWheel.castShadow = true;
    car.add(rearRightWheel);
    
    // Position car at start
    car.position.set(0, 0, 0);
    scene.add(car);
}

function createTrack() {
    track = new THREE.Group();
    
    // Use the existing trackWaypoints array instead of generating new points
    const trackPoints = [];
    const innerPoints = [];
    const outerPoints = [];
    
    // Convert existing waypoints to track geometry
    for (let i = 0; i < trackWaypoints.length; i++) {
        const waypoint = trackWaypoints[i];
        
        trackPoints.push(new THREE.Vector3(waypoint.x, 0, waypoint.z));
        
        // Calculate perpendicular direction for track width
        let perpAngle;
        if (i < trackWaypoints.length - 1) {
            // Use direction to next waypoint
            const nextWaypoint = trackWaypoints[i + 1];
            perpAngle = Math.atan2(nextWaypoint.z - waypoint.z, nextWaypoint.x - waypoint.x) + Math.PI / 2;
        } else {
            // For last waypoint, connect back to first waypoint for closed loop
            const firstWaypoint = trackWaypoints[0];
            perpAngle = Math.atan2(firstWaypoint.z - waypoint.z, firstWaypoint.x - waypoint.x) + Math.PI / 2;
        }
        
        // Create inner and outer points based on track width
        const halfWidth = trackWidth / 2;
        const innerX = waypoint.x + Math.cos(perpAngle) * halfWidth;
        const innerZ = waypoint.z + Math.sin(perpAngle) * halfWidth;
        const outerX = waypoint.x - Math.cos(perpAngle) * halfWidth;
        const outerZ = waypoint.z - Math.sin(perpAngle) * halfWidth;
        
        innerPoints.push(new THREE.Vector3(innerX, 0, innerZ));
        outerPoints.push(new THREE.Vector3(outerX, 0, outerZ));
    }
    
    // Store track boundaries for collision detection
    window.trackInnerPoints = innerPoints;
    window.trackOuterPoints = outerPoints;
    
    // Create track geometry
    const trackGeometry = new THREE.BufferGeometry();
    const vertices = [];
    const indices = [];
    
    // Create track surface vertices (close the loop)
    for (let i = 0; i < trackPoints.length; i++) {
        const nextIndex = (i + 1) % trackPoints.length; // Wrap around to close the loop
        
        const inner1 = innerPoints[i];
        const outer1 = outerPoints[i];
        const inner2 = innerPoints[nextIndex];
        const outer2 = outerPoints[nextIndex];
        
        vertices.push(
            inner1.x, inner1.y, inner1.z,
            outer1.x, outer1.y, outer1.z,
            inner2.x, inner2.y, inner2.z,
            outer2.x, outer2.y, outer2.z
        );
        
        const baseIndex = i * 4;
        indices.push(
            baseIndex, baseIndex + 1, baseIndex + 2,
            baseIndex + 1, baseIndex + 3, baseIndex + 2
        );
    }
    
    trackGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    trackGeometry.setIndex(indices);
    trackGeometry.computeVertexNormals();
    
    const trackMaterial = new THREE.MeshLambertMaterial({ 
        color: 0x333333,
        side: THREE.DoubleSide
    });
    
    const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
    trackMesh.receiveShadow = true;
    track.add(trackMesh);
    
    // Add track markings
    createTrackMarkings(trackPoints, trackWidth);
    
    // Add barriers
    createBarriers(innerPoints, outerPoints);
    
    scene.add(track);
}

function createTrackMarkings(centerPoints, width) {
    // Center line
    const centerLineGeometry = new THREE.BufferGeometry();
    const centerVertices = [];
    
    for (let i = 0; i < centerPoints.length - 1; i++) {
        const p1 = centerPoints[i];
        const p2 = centerPoints[i + 1];
        
        centerVertices.push(p1.x, p1.y + 0.1, p1.z);
        centerVertices.push(p2.x, p2.y + 0.1, p2.z);
    }
    
    centerLineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(centerVertices, 3));
    
    const centerLineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const centerLine = new THREE.LineSegments(centerLineGeometry, centerLineMaterial);
    track.add(centerLine);
}

function createBarriers(innerPoints, outerPoints) {
    // Clear existing barriers array
    barriers = [];
    
    // Only add outer barriers on curves with radius above threshold
    for (let i = 0; i < outerPoints.length - 1; i++) {
        const p1 = outerPoints[i];
        const p2 = outerPoints[i + 1];
        
        // Calculate the radius at this point
        const angle = (i / outerPoints.length) * Math.PI * 2;
        const normalizedAngle = angle % (Math.PI * 2);
        
        let currentRadius = trackRadius;
        
        // Match the radius calculation from createTrack
        if (normalizedAngle >= 0 && normalizedAngle < Math.PI * 0.3) {
            const straightProgress = normalizedAngle / (Math.PI * 0.3);
            currentRadius = trackRadius + (150 * straightProgress);
        } else if (normalizedAngle >= Math.PI * 0.3 && normalizedAngle < Math.PI * 0.7) {
            const curveAngle = (normalizedAngle - Math.PI * 0.3) / (Math.PI * 0.4);
            const bendFactor = Math.sin(curveAngle * Math.PI * 3) * 80;
            currentRadius = trackRadius + 150 + bendFactor;
        } else if (normalizedAngle >= Math.PI * 0.7 && normalizedAngle < Math.PI * 1.3) {
            const straightProgress = (normalizedAngle - Math.PI * 0.7) / (Math.PI * 0.6);
            currentRadius = trackRadius + 150 - (150 * straightProgress);
        } else {
            const curveAngle = (normalizedAngle - Math.PI * 1.3) / (Math.PI * 0.7);
            const bendFactor = Math.sin(curveAngle * Math.PI * 4) * 60;
            currentRadius = trackRadius + bendFactor;
        }
        
        // Only add barrier if radius is above threshold (outside of tight curves)
        if (Barrier.shouldCreateAtRadius(currentRadius)) {
            const distance = p1.distanceTo(p2);
            const position = new THREE.Vector3(
                (p1.x + p2.x) / 2,
                2.5, // Height / 2
                (p1.z + p2.z) / 2
            );
            
            // Calculate angle between points and align barrier tangential to track
            const barrierAngle = Math.atan2(p2.x - p1.x, p2.z - p1.z);
            
            // Create new barrier instance
            const barrier = new Barrier(position, barrierAngle, distance);
            barrier.addToScene(track);
            barriers.push(barrier);
        }
    }
}

function getCarBoundingBox() {
    // Create a smaller bounding box for the car (80% of actual size)
    const box = new THREE.Box3().setFromObject(car);
    const shrinkFactor = 0.8;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(shrinkFactor);
    
    box.setFromCenterAndSize(center, size);
    return box;
}

function checkCollisions() {
    // Update car bounding box (smaller)
    carBoundingBox = getCarBoundingBox();
    
    // Check collision with each barrier
    for (let i = 0; i < barriers.length; i++) {
        const barrier = barriers[i];
        const barrierBox = barrier.getBoundingBox();
        
        if (carBoundingBox.intersectsBox(barrierBox)) {
            const collisionResult = barrier.handleCollision(carPosition, carSpeed, carRotation);
            
            // Apply collision effects to car
            carPosition.x += collisionResult.bounceForce.x;
            carPosition.z += collisionResult.bounceForce.z;
            carSpeed *= collisionResult.speedReduction;
        }
        
        // Update barrier physics
        barrier.updatePhysics();
    }
}

function setupCameras() {
    // Third person camera
    thirdPersonCamera = new THREE.PerspectiveCamera(75, windowWidth / windowHeight, 0.1, 2000);
    
    // First person camera
    firstPersonCamera = new THREE.PerspectiveCamera(90, windowWidth / windowHeight, 0.1, 2000);
    
    camera = thirdPersonCamera;
}

function generateTrackWaypoints() {
    const segments = 200; // Match createTrack segments
    const radius = 300;   // Match createTrack radius
    
    trackWaypoints = [];
    
    // Continue with circular track generation
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        
        // Use same bend calculation as createTrack
        let currentRadius = radius;
        const bendFactor = Math.sin(angle * 4.5) * 50; // Match createTrack exactly
        currentRadius += bendFactor;
        
        const x = Math.cos(angle) * currentRadius;
        const z = Math.sin(angle) * currentRadius;
        
        trackWaypoints.push({ x, z, angle });
    }
}

function isOnTrack(x, z) {
    // Check if car position is within track width of any waypoint
    const carPosition = { x: x, z: z };
    const trackWidthRadius = trackWidth / 2; // Half track width as radius
    
    // Check distance to each waypoint
    for (let i = 0; i < trackWaypoints.length; i++) {
        const waypoint = trackWaypoints[i];
        const distance = Math.sqrt(
            Math.pow(carPosition.x - waypoint.x, 2) + 
            Math.pow(carPosition.z - waypoint.z, 2)
        );
        
        // If car is within track width of any waypoint, it's on track
        if (distance <= trackWidthRadius) {
            return true;
        }
    }
    
    // If not within radius of any waypoint, car is off track
    return false;
}

function draw() {
    // Handle input
    handleInput();
    
    // Update car physics
    updateCar();
    
    // Check collisions with barriers
    checkCollisions();
    
    // Update camera
    updateCamera();
    
    // Update speed display
    document.getElementById('speedValue').textContent = Math.round(Math.abs(carSpeed * 10));
    
    // Render Three.js scene
    renderer.render(scene, camera);
}

function handleInput() {
    // Check if car is on track
    const onTrack = isOnTrack(carPosition.x, carPosition.z);
    
    // Adjust max speed based on surface
    let currentMaxSpeed = maxSpeed;
    if (!onTrack) {
        // Reduce max speed on grass to 60% of normal speed
        currentMaxSpeed = maxSpeed * 0.6;
    }
    
    // Acceleration and braking
    if (keys.up) {
        carSpeed = Math.min(carSpeed + acceleration, currentMaxSpeed);
    } else if (keys.down) {
        carSpeed = Math.max(carSpeed - acceleration, -currentMaxSpeed * 0.5);
    } else {
        // Natural deceleration
        if (carSpeed > 0) {
            carSpeed = Math.max(carSpeed - deceleration, 0);
        } else if (carSpeed < 0) {
            carSpeed = Math.min(carSpeed + deceleration, 0);
        }
    }

    // If car exceeds max speed for current surface, slow it down
    if (Math.abs(carSpeed) > currentMaxSpeed) {
        carSpeed = carSpeed > 0 ? currentMaxSpeed : -currentMaxSpeed;
    }
    
    // Steering - allow turning even at very low speeds
    const minSpeedForTurning = 0.01; // Much lower threshold
    if (Math.abs(carSpeed) > minSpeedForTurning) {
        const speedFactor = Math.min(Math.abs(carSpeed) / maxSpeed, 1.0);
        const currentTurnSpeed = turnSpeed * (0.5 + 0.5 * speedFactor); // Increased minimum to 50% turn speed
        
        if (keys.left) {
            carRotation += currentTurnSpeed * 1.5; // Increased turn rate by 50%
        }
        if (keys.right) {
            carRotation -= currentTurnSpeed * 1.5; // Increased turn rate by 50%
        }
    }
    
    // Camera switching
    if (keys.space && !isFirstPerson) {
        isFirstPerson = true;
        camera = firstPersonCamera;
    } else if (!keys.space && isFirstPerson) {
        isFirstPerson = false;
        camera = thirdPersonCamera;
    }
}

function updateCar() {
    // Update car position
    const speedFactor = carSpeed * 0.1;
    carPosition.x += Math.sin(carRotation) * speedFactor;
    carPosition.z += Math.cos(carRotation) * speedFactor;
    
    // Update car mesh
    car.position.set(carPosition.x, carPosition.y, carPosition.z);
    car.rotation.y = carRotation;
}

function updateCamera() {
    if (isFirstPerson) {
        // First person view - inside the car
        firstPersonCamera.position.set(
            carPosition.x,
            carPosition.y + 3,
            carPosition.z
        );
        firstPersonCamera.rotation.y = carRotation;
        firstPersonCamera.lookAt(
            carPosition.x + Math.sin(carRotation) * 10,
            carPosition.y + 3,
            carPosition.z + Math.cos(carRotation) * 10
        );
    } else {
        // Third person view - behind the car
        const cameraDistance = 50;
        const cameraHeight = 20;
        
        thirdPersonCamera.position.set(
            carPosition.x - Math.sin(carRotation) * cameraDistance,
            carPosition.y + cameraHeight,
            carPosition.z - Math.cos(carRotation) * cameraDistance
        );
        
        thirdPersonCamera.lookAt(carPosition.x, carPosition.y, carPosition.z);
    }
}

// Event listeners for keyboard input
function keyPressed() {
    switch (keyCode) {
        case UP_ARROW:
            keys.up = true;
            break;
        case DOWN_ARROW:
            keys.down = true;
            break;
        case LEFT_ARROW:
            keys.left = true;
            break;
        case RIGHT_ARROW:
            keys.right = true;
            break;
        case 32: // Space bar
            keys.space = true;
            break;
    }
    return false; // Prevent default behavior
}

function keyReleased() {
    switch (keyCode) {
        case UP_ARROW:
            keys.up = false;
            break;
        case DOWN_ARROW:
            keys.down = false;
            break;
        case LEFT_ARROW:
            keys.left = false;
            break;
        case RIGHT_ARROW:
            keys.right = false;
            break;
        case 32: // Space bar
            keys.space = false;
            break;
    }
    return false; // Prevent default behavior
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    if (camera) {
        camera.aspect = windowWidth / windowHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(windowWidth, windowHeight);
    }
} 