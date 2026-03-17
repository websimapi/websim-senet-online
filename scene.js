import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
import { getBoardCoordinates } from './senet_rules.js';
import { audio } from './audio.js';

export class SceneManager {
    constructor(container, onInteract) {
        this.container = container;
        this.onInteract = onInteract;
        this.piecesMeshes = {};
        this.sticks = [];
        this.stickBodies = [];
        this.highlightBoxes = [];
        this.boardMeshes = [];
        this.targetLerpPos = new THREE.Vector3(-3, 0, 0);
        this.isLerpingTarget = false;
        
        this.initThree();
        this.initCannon();
        this.buildTable();
        this.buildBoard();
        this.buildPieces();
        this.buildSticks();

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isDragging = false;
        this.downPos = null;

        window.addEventListener('pointerdown', (e) => {
            this.isDragging = false;
            this.downPos = { x: e.clientX, y: e.clientY };
        });
        
        window.addEventListener('pointermove', (e) => {
            if (this.downPos) {
                const dist = Math.abs(e.clientX - this.downPos.x) + Math.abs(e.clientY - this.downPos.y);
                if (dist > 10) this.isDragging = true;
            }
        });

        window.addEventListener('pointerup', this.onPointerUp.bind(this));
        window.addEventListener('resize', this.onWindowResize.bind(this));

        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 150);
        this.camera.position.set(0, 35, 45);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.target.set(-3, 0, 0);
        this.controls.maxPolarAngle = Math.PI / 2.2; // Don't go below board
        this.controls.minDistance = 10;
        this.controls.maxDistance = 80;
        this.controls.enablePan = true;
        this.controls.addEventListener('start', () => {
            this.isLerpingTarget = false;
        });

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        this.scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xfff0dd, 1.8);
        dirLight.position.set(15, 30, 15);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.top = 25;
        dirLight.shadow.camera.bottom = -25;
        dirLight.shadow.camera.left = -25;
        dirLight.shadow.camera.right = 25;
        this.scene.add(dirLight);
    }

    initCannon() {
        this.world = new CANNON.World({
            gravity: new CANNON.Vec3(0, -30, 0), // Strong gravity for snappy throws
        });
        
        // Materials
        this.boardMat = new CANNON.Material();
        const stickMat = new CANNON.Material();
        const contactMat = new CANNON.ContactMaterial(this.boardMat, stickMat, {
            friction: 0.4,
            restitution: 0.3
        });
        this.world.addContactMaterial(contactMat);
    }

    buildTable() {
        // Large table
        const tableGeo = new THREE.BoxGeometry(60, 2, 40);
        
        const textureLoader = new THREE.TextureLoader();
        const woodTexture = textureLoader.load('wood_texture.png');
        woodTexture.wrapS = THREE.RepeatWrapping;
        woodTexture.wrapT = THREE.RepeatWrapping;
        woodTexture.repeat.set(4, 4);

        const tableMat = new THREE.MeshStandardMaterial({ 
            color: 0xdeb887, // Lighter brown
            map: woodTexture,
            roughness: 0.8 
        });
        const table = new THREE.Mesh(tableGeo, tableMat);
        table.position.set(2, -1.5, 0); 
        table.receiveShadow = true;
        this.scene.add(table);

        // Physics for table
        const tableShape = new CANNON.Box(new CANNON.Vec3(30, 1, 20));
        const tableBody = new CANNON.Body({ mass: 0, material: this.boardMat });
        tableBody.addShape(tableShape);
        tableBody.position.set(2, -1.5, 0);
        this.world.addBody(tableBody);

        tableBody.addEventListener("collide", (e) => {
            const relativeVelocity = e.contact.getImpactVelocityAlongNormal();
            if (Math.abs(relativeVelocity) > 2) {
                audio.playClack(Math.min(1.0, Math.abs(relativeVelocity) / 10));
            }
        });

        // Invisible walls for the throwing area on right side of the table
        const wallShapeX = new CANNON.Box(new CANNON.Vec3(0.5, 5, 10));
        const wallShapeZ = new CANNON.Box(new CANNON.Vec3(6, 5, 0.5));

        const wallLeft = new CANNON.Body({ mass: 0, material: this.boardMat });
        wallLeft.addShape(wallShapeX);
        wallLeft.position.set(9, 2, 0);
        this.world.addBody(wallLeft);

        const wallRight = new CANNON.Body({ mass: 0, material: this.boardMat });
        wallRight.addShape(wallShapeX);
        wallRight.position.set(20, 2, 0);
        this.world.addBody(wallRight);

        const wallTop = new CANNON.Body({ mass: 0, material: this.boardMat });
        wallTop.addShape(wallShapeZ);
        wallTop.position.set(14.5, 2, -9);
        this.world.addBody(wallTop);

        const wallBottom = new CANNON.Body({ mass: 0, material: this.boardMat });
        wallBottom.addShape(wallShapeZ);
        wallBottom.position.set(14.5, 2, 9);
        this.world.addBody(wallBottom);
    }

    buildBoard() {
        // Base Box
        const baseGeo = new THREE.BoxGeometry(21, 0.5, 7);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.set(-3, -0.25, 0); // Center of the left-shifted board
        base.receiveShadow = true;
        base.userData = { isBoard: true };
        this.scene.add(base);
        this.boardMeshes.push(base);

        // Tiles
        const tileGeo = new THREE.BoxGeometry(1.9, 0.1, 1.9);
        const matOdd = new THREE.MeshStandardMaterial({ color: 0xdeb887 });
        const matEven = new THREE.MeshStandardMaterial({ color: 0xd2b48c });
        const matSpecial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });

        for (let i = 0; i < 30; i++) {
            let mat = (i % 2 === 0) ? matEven : matOdd;
            if (i === 25 || i === 26 || i === 27 || i === 28 || i === 29) {
                mat = matSpecial;
            }
            const tile = new THREE.Mesh(tileGeo, mat);
            const pos = getBoardCoordinates(i);
            tile.position.set(pos.x, 0.05, pos.z);
            tile.receiveShadow = true;
            tile.userData = { isBoard: true };
            this.scene.add(tile);
            this.boardMeshes.push(tile);
        }
    }

    buildPieces() {
        // P1: Cones (Black)
        const p1Geo = new THREE.ConeGeometry(0.6, 1.5, 16);
        p1Geo.translate(0, 0.75, 0);
        const p1Mat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });

        // P2: Cylinders/Spools (White)
        const p2Geo = new THREE.CylinderGeometry(0.6, 0.6, 1.2, 16);
        p2Geo.translate(0, 0.6, 0);
        const p2Mat = new THREE.MeshStandardMaterial({ color: 0xf5f5dc, roughness: 0.4 });

        for (let i = 0; i < 5; i++) {
            const mesh1 = new THREE.Mesh(p1Geo, p1Mat);
            mesh1.castShadow = true;
            mesh1.userData = { id: `p1_${i}` };
            this.scene.add(mesh1);
            this.piecesMeshes[`p1_${i}`] = mesh1;

            const mesh2 = new THREE.Mesh(p2Geo, p2Mat);
            mesh2.castShadow = true;
            mesh2.userData = { id: `p2_${i}` };
            this.scene.add(mesh2);
            this.piecesMeshes[`p2_${i}`] = mesh2;
        }
    }

    buildSticks() {
        const size = { x: 0.4, y: 0.15, z: 2.5 };
        const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
        
        // Multi-material box for Two sides
        const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 }); // Brown (Dark)
        const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff }); // White (Light)
        // Materials array: right, left, top, bottom, front, back
        const materials = [darkMat, darkMat, lightMat, darkMat, darkMat, darkMat];

        for (let i = 0; i < 4; i++) {
            // Physics body
            const body = new CANNON.Body({
                mass: 1,
                shape: shape,
                position: new CANNON.Vec3(13.5 + i * 0.6, -0.42, 0) // Place neatly
            });
            // Rotate to show black side up (Three.js top face +Y rotated 180 on Z)
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI);
            this.world.addBody(body);
            this.stickBodies.push(body);

            // Visual mesh
            const mesh = new THREE.Mesh(geo, materials);
            mesh.castShadow = true;
            mesh.userData = { isStick: true };
            this.scene.add(mesh);
            this.sticks.push(mesh);
        }
    }

    updatePiecesPositions(statePieces) {
        for (const [id, posIndex] of Object.entries(statePieces)) {
            const mesh = this.piecesMeshes[id];
            if (posIndex === -1) {
                // Move off board securely out of view
                mesh.position.set(0, -10, 0); 
                continue;
            }
            const targetPos = getBoardCoordinates(posIndex);
            if (targetPos) {
                // Simple lerp animation could go here, for now jump
                mesh.position.set(targetPos.x, targetPos.y, targetPos.z);
            }
        }
    }

    showMovablePieces(pieceIds, statePieces) {
        this.clearHighlights();

        const geo = new THREE.BoxGeometry(2.0, 0.05, 2.0);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.5 });

        pieceIds.forEach(id => {
            const posIndex = statePieces[id];
            if (posIndex === -1) return;
            const pos = getBoardCoordinates(posIndex);
            if (pos) {
                const box = new THREE.Mesh(geo, mat);
                box.position.set(pos.x, 0.08, pos.z);
                box.userData = { id: id };
                this.scene.add(box);
                this.highlightBoxes.push(box);
            }
            if (this.piecesMeshes[id]) {
                this.piecesMeshes[id].material.emissive.setHex(0x333300);
            }
        });
    }

    showValidMoves(moves, selectedPieceId) {
        this.clearHighlights();

        if (selectedPieceId && this.piecesMeshes[selectedPieceId]) {
            this.piecesMeshes[selectedPieceId].material.emissive.setHex(0x555500); // Yellow highlight for selected
        }

        const geo = new THREE.BoxGeometry(1.8, 0.2, 1.8);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });

        moves.forEach(m => {
            const box = new THREE.Mesh(geo, mat);
            if (m.targetPos === -1) {
                const pos = getBoardCoordinates(29);
                box.position.set(pos.x + 3, 0.2, pos.z); // Put exit zone slightly right of final square
            } else {
                const pos = getBoardCoordinates(m.targetPos);
                box.position.set(pos.x, 0.2, pos.z);
            }
            box.userData = { isMove: true, move: m };
            this.scene.add(box);
            this.highlightBoxes.push(box);
        });
    }

    clearHighlights() {
        this.highlightBoxes.forEach(b => this.scene.remove(b));
        this.highlightBoxes = [];
        Object.values(this.piecesMeshes).forEach(m => {
            m.material.emissive.setHex(0x000000);
        });
    }

    onPointerUp(event) {
        this.downPos = null;
        if (this.isDragging) return;

        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        const interactables = [...Object.values(this.piecesMeshes), ...this.highlightBoxes, ...this.boardMeshes, ...this.sticks];
        const intersects = this.raycaster.intersectObjects(interactables);
        
        if (intersects.length > 0) {
            const object = intersects[0].object;
            if (object.userData.isMove) {
                this.onInteract('move', object.userData.move);
            } else if (object.userData.isStick) {
                this.focusOnSticks();
                this.onInteract('sticks', null);
            } else if (object.userData.id) {
                this.focusCameraOn(object.position);
                this.onInteract('piece', object.userData.id);
            } else if (object.userData.isBoard) {
                this.focusCameraOn(new THREE.Vector3(-3, 0, 0));
                this.onInteract('none', null);
            }
        } else {
            this.onInteract('none', null);
        }
    }

    focusOnSticks() {
        this.focusCameraOn(new THREE.Vector3(14.5, 0, 0));
    }

    focusCameraOn(position) {
        this.targetLerpPos.copy(position);
        this.isLerpingTarget = true;
    }

    applyThrowImpulses(impulses) {
        this.isShaking = true;
        this.shakeTime = 0;
        this.pendingImpulses = impulses;

        // Random direction for the hand to tilt when tossing
        this.handTiltX = (Math.random() - 0.5) * Math.PI;
        this.handTiltZ = (Math.random() - 0.5) * Math.PI;

        // Make sticks kinematic for the shake animation
        for (let i = 0; i < 4; i++) {
            const body = this.stickBodies[i];
            body.type = CANNON.Body.KINEMATIC;
            body.velocity.set(0, 0, 0);
            body.angularVelocity.set(0, 0, 0);
        }
    }

    checkSticksSettled() {
        if (this.isShaking) return false;
        let settled = true;
        for (const body of this.stickBodies) {
            if (body.velocity.lengthSquared() > 0.05 || body.angularVelocity.lengthSquared() > 0.05) {
                settled = false;
                break;
            }
        }
        return settled;
    }

    calculateRollValue() {
        let lightSidesUp = 0;
        const upVector = new CANNON.Vec3(0, 1, 0);
        
        for (let i = 0; i < 4; i++) {
            const body = this.stickBodies[i];
            // Get local Y axis (which corresponds to top/bottom face due to geometry setup)
            // ThreeJS geometry top is +Y. 
            const localY = new CANNON.Vec3(0, 1, 0);
            const worldY = body.quaternion.vmult(localY);
            
            // If the stick's local +Y points up in the world, it's white side up.
            if (worldY.y > 0.5) {
                lightSidesUp++;
            }
        }
        
        // Senet logic: 0 light = 5
        return lightSidesUp === 0 ? 5 : lightSidesUp;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(this.animate);
        
        // Step Physics
        this.world.step(1 / 60);

        if (this.isShaking) {
            this.shakeTime += 1 / 60;
            const liftProgress = Math.min(this.shakeTime / 0.2, 1.0);
            const dropProgress = Math.max(0, (this.shakeTime - 0.4) / 0.2);
            
            for (let i = 0; i < 4; i++) {
                const body = this.stickBodies[i];
                
                // Cupped hand targets (tighter spacing, lower height)
                const targetX = 14.5 + (i % 2) * 0.8 - 0.4;
                const targetY = 1.8;
                const targetZ = (i < 2 ? -0.4 : 0.4);
                
                const shakeIntensity = liftProgress * (1 - dropProgress) * 0.3;
                const shakeX = (Math.random() - 0.5) * shakeIntensity;
                const shakeY = (Math.random() - 0.5) * shakeIntensity;
                const shakeZ = (Math.random() - 0.5) * shakeIntensity;
                
                // Tilt offset to simulate pouring out of the hand
                const pourOffsetX = Math.sin(this.handTiltZ) * dropProgress * 1.5;
                const pourOffsetZ = -Math.sin(this.handTiltX) * dropProgress * 1.5;
                const pourOffsetY = -dropProgress * 0.5;

                const targetPos = new CANNON.Vec3(
                    targetX + shakeX + pourOffsetX, 
                    targetY + shakeY + pourOffsetY, 
                    targetZ + shakeZ + pourOffsetZ
                );
                body.position.lerp(targetPos, 0.4, body.position);
                
                // Rotation: base jitter + tilt drop
                const baseJitterX = (Math.random() - 0.5) * shakeIntensity * 2;
                const baseJitterY = (Math.random() - 0.5) * shakeIntensity * 2;
                const baseJitterZ = (Math.random() - 0.5) * shakeIntensity * 2;

                const currentTiltX = baseJitterX + (this.handTiltX * dropProgress);
                const currentTiltZ = baseJitterZ + (this.handTiltZ * dropProgress);

                const targetQuat = new CANNON.Quaternion();
                targetQuat.setFromEuler(currentTiltX, baseJitterY, currentTiltZ);
                body.quaternion.slerp(targetQuat, 0.4, body.quaternion);
            }
            
            if (this.shakeTime > 0.6) {
                this.isShaking = false;
                for (let i = 0; i < 4; i++) {
                    const body = this.stickBodies[i];
                    body.type = CANNON.Body.DYNAMIC;
                    
                    body.applyImpulse(
                        new CANNON.Vec3(this.pendingImpulses[i].fx, this.pendingImpulses[i].fy, this.pendingImpulses[i].fz),
                        new CANNON.Vec3(0, 0, 0)
                    );
                    body.angularVelocity.set(this.pendingImpulses[i].tx, this.pendingImpulses[i].ty, this.pendingImpulses[i].tz);
                }
            }
        }

        // Sync meshes
        for (let i = 0; i < 4; i++) {
            this.sticks[i].position.copy(this.stickBodies[i].position);
            this.sticks[i].quaternion.copy(this.stickBodies[i].quaternion);
        }

        if (this.isLerpingTarget) {
            this.controls.target.lerp(this.targetLerpPos, 0.1);
            if (this.controls.target.distanceTo(this.targetLerpPos) < 0.01) {
                this.isLerpingTarget = false;
            }
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}