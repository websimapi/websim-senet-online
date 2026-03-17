import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
import { getBoardCoordinates } from './senet_rules.js';
import { audio } from './audio.js';

export class SceneManager {
    constructor(container, onPieceClick) {
        this.container = container;
        this.onPieceClick = onPieceClick;
        this.piecesMeshes = {};
        this.sticks = [];
        this.stickBodies = [];
        this.highlightBoxes = [];
        
        this.initThree();
        this.initCannon();
        this.buildBoard();
        this.buildPieces();
        this.buildSticks();

        // Interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        window.addEventListener('pointerdown', this.onPointerDown.bind(this));
        window.addEventListener('resize', this.onWindowResize.bind(this));

        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);

        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 15, 18);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI / 2.1; // Don't go below board
        this.controls.minDistance = 10;
        this.controls.maxDistance = 30;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xfff0dd, 1.5);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.camera.top = 15;
        dirLight.shadow.camera.bottom = -15;
        dirLight.shadow.camera.left = -15;
        dirLight.shadow.camera.right = 15;
        this.scene.add(dirLight);
    }

    initCannon() {
        this.world = new CANNON.World({
            gravity: new CANNON.Vec3(0, -20, 0), // Stronger gravity for snappy throws
        });
        
        // Materials
        const boardMat = new CANNON.Material();
        const stickMat = new CANNON.Material();
        const contactMat = new CANNON.ContactMaterial(boardMat, stickMat, {
            friction: 0.3,
            restitution: 0.4
        });
        this.world.addContactMaterial(contactMat);

        // Ground Plane Body
        const groundShape = new CANNON.Plane();
        this.groundBody = new CANNON.Body({ mass: 0, material: boardMat });
        this.groundBody.addShape(groundShape);
        this.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        this.world.addBody(this.groundBody);
        
        // Collision listener for sound
        this.groundBody.addEventListener("collide", (e) => {
            const relativeVelocity = e.contact.getImpactVelocityAlongNormal();
            if (Math.abs(relativeVelocity) > 2) {
                audio.playClack(Math.min(1.0, Math.abs(relativeVelocity) / 10));
            }
        });
    }

    buildBoard() {
        // Base Box
        const baseGeo = new THREE.BoxGeometry(21, 1, 7);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
        const base = new THREE.Mesh(baseGeo, baseMat);
        base.position.y = -0.5;
        base.receiveShadow = true;
        this.scene.add(base);

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
            this.scene.add(tile);
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
                position: new CANNON.Vec3(0, -5, 0) // Hide initially
            });
            this.world.addBody(body);
            this.stickBodies.push(body);

            // Visual mesh
            const mesh = new THREE.Mesh(geo, materials);
            mesh.castShadow = true;
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

    showValidMoves(moves) {
        // Clear old
        this.highlightBoxes.forEach(b => this.scene.remove(b));
        this.highlightBoxes = [];

        const geo = new THREE.BoxGeometry(1.8, 0.2, 1.8);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });

        moves.forEach(m => {
            if (m.targetPos === -1) return; // Exit board move
            const pos = getBoardCoordinates(m.targetPos);
            const box = new THREE.Mesh(geo, mat);
            box.position.set(pos.x, 0.2, pos.z);
            this.scene.add(box);
            this.highlightBoxes.push(box);

            // Highlight the piece that can move
            const pieceMesh = this.piecesMeshes[m.pieceId];
            if (pieceMesh) {
                 pieceMesh.material.emissive.setHex(0x333333);
            }
        });
    }

    clearHighlights() {
        this.highlightBoxes.forEach(b => this.scene.remove(b));
        this.highlightBoxes = [];
        Object.values(this.piecesMeshes).forEach(m => {
            m.material.emissive.setHex(0x000000);
        });
    }

    onPointerDown(event) {
        // Normalize mouse coordinates
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Intersect pieces
        const intersects = this.raycaster.intersectObjects(Object.values(this.piecesMeshes));
        if (intersects.length > 0) {
            const pieceId = intersects[0].object.userData.id;
            this.onPieceClick(pieceId);
        }
    }

    applyThrowImpulses(impulses) {
        // Place sticks above board and apply forces
        for (let i = 0; i < 4; i++) {
            const body = this.stickBodies[i];
            
            // Reset position slightly spread out
            body.position.set(-3 + i * 2, 8 + Math.random(), 0);
            body.velocity.set(0,0,0);
            body.angularVelocity.set(0,0,0);
            
            // Randomize initial rotation slightly
            body.quaternion.setFromEuler(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI
            );

            // Apply synced impulses
            body.applyImpulse(
                new CANNON.Vec3(impulses[i].fx, impulses[i].fy, impulses[i].fz),
                new CANNON.Vec3(0, 0, 0)
            );
            
            body.angularVelocity.set(impulses[i].tx, impulses[i].ty, impulses[i].tz);
        }
    }

    checkSticksSettled() {
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

        // Sync meshes
        for (let i = 0; i < 4; i++) {
            this.sticks[i].position.copy(this.stickBodies[i].position);
            this.sticks[i].quaternion.copy(this.stickBodies[i].quaternion);
        }

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }
}