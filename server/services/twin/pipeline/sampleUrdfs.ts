/**
 * T2a — SAMPLE URDF fixtures. A simple 3-DOF articulated arm + a 2-DOF planar arm,
 * authored with PRIMITIVE geometry (box/cylinder) so the pipeline can convert them
 * end-to-end without any external mesh file. Used by the pipeline tests AND available as
 * a seedable "convertible source" so the model registry can be filled with a real,
 * renderable glTF out of the box. Units are METRES / RADIANS (URDF convention).
 */

/** A simple 3-DOF arm: base → shoulder(revolute Z) → elbow(revolute Y) → wrist(revolute Y). */
export const SAMPLE_URDF_3DOF_ARM = `<?xml version="1.0"?>
<robot name="sample_3dof_arm">
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.05" rpy="0 0 0"/>
      <geometry><cylinder radius="0.08" length="0.1"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.05" rpy="0 0 0"/>
      <geometry><cylinder radius="0.08" length="0.1"/></geometry>
    </collision>
  </link>
  <link name="link1">
    <visual>
      <origin xyz="0 0 0.15" rpy="0 0 0"/>
      <geometry><box size="0.06 0.06 0.3"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.15" rpy="0 0 0"/>
      <geometry><box size="0.06 0.06 0.3"/></geometry>
    </collision>
  </link>
  <link name="link2">
    <visual>
      <origin xyz="0 0 0.125" rpy="0 0 0"/>
      <geometry><box size="0.05 0.05 0.25"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.125" rpy="0 0 0"/>
      <geometry><box size="0.05 0.05 0.25"/></geometry>
    </collision>
  </link>
  <link name="tool_link">
    <visual>
      <origin xyz="0 0 0.03" rpy="0 0 0"/>
      <geometry><sphere radius="0.04"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.03" rpy="0 0 0"/>
      <geometry><sphere radius="0.04"/></geometry>
    </collision>
  </link>

  <joint name="shoulder" type="revolute">
    <parent link="base_link"/>
    <child link="link1"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14159" upper="3.14159" effort="150" velocity="3.14"/>
  </joint>
  <joint name="elbow" type="revolute">
    <parent link="link1"/>
    <child link="link2"/>
    <origin xyz="0 0 0.3" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-2.35619" upper="2.35619" effort="100" velocity="3.14"/>
  </joint>
  <joint name="wrist" type="revolute">
    <parent link="link2"/>
    <child link="tool_link"/>
    <origin xyz="0 0 0.25" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-1.5708" upper="1.5708" effort="50" velocity="3.14"/>
  </joint>
</robot>`;

/**
 * A parametric AOI inspection machine: a cabinet base, a conveyor deck, a gantry bridge
 * spanning the deck, and an inspection head that rides the bridge. Authored with primitive
 * geometry (box/cylinder) so the pipeline converts it end-to-end into a real, renderable
 * glTF (no external mesh files). Prismatic joints model the real gantry/head travel so the
 * kinematic + bounds are honest. Units are METRES / RADIANS. Approx footprint ~1.2×0.9×1.6 m.
 */
export const SAMPLE_URDF_AOI_MACHINE = `<?xml version="1.0"?>
<robot name="aoi_inspection_machine">
  <link name="cabinet">
    <visual>
      <origin xyz="0 0 0.45" rpy="0 0 0"/>
      <geometry><box size="1.2 0.9 0.9"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.45" rpy="0 0 0"/>
      <geometry><box size="1.2 0.9 0.9"/></geometry>
    </collision>
  </link>
  <link name="conveyor">
    <visual>
      <origin xyz="0 0 0.03" rpy="0 0 0"/>
      <geometry><box size="1.2 0.35 0.06"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0.03" rpy="0 0 0"/>
      <geometry><box size="1.2 0.35 0.06"/></geometry>
    </collision>
  </link>
  <link name="column_left">
    <visual>
      <origin xyz="0 0 0.3" rpy="0 0 0"/>
      <geometry><box size="0.08 0.08 0.6"/></geometry>
    </visual>
  </link>
  <link name="column_right">
    <visual>
      <origin xyz="0 0 0.3" rpy="0 0 0"/>
      <geometry><box size="0.08 0.08 0.6"/></geometry>
    </visual>
  </link>
  <link name="bridge">
    <visual>
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <geometry><cylinder radius="0.05" length="1.0"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <geometry><cylinder radius="0.05" length="1.0"/></geometry>
    </collision>
  </link>
  <link name="inspection_head">
    <visual>
      <origin xyz="0 0 -0.1" rpy="0 0 0"/>
      <geometry><box size="0.18 0.18 0.22"/></geometry>
    </visual>
    <collision>
      <origin xyz="0 0 -0.1" rpy="0 0 0"/>
      <geometry><box size="0.18 0.18 0.22"/></geometry>
    </collision>
  </link>
  <link name="lens">
    <visual>
      <origin xyz="0 0 -0.02" rpy="0 0 0"/>
      <geometry><cylinder radius="0.04" length="0.06"/></geometry>
    </visual>
  </link>

  <joint name="deck" type="fixed">
    <parent link="cabinet"/><child link="conveyor"/>
    <origin xyz="0 0 0.9" rpy="0 0 0"/>
  </joint>
  <joint name="post_left" type="fixed">
    <parent link="cabinet"/><child link="column_left"/>
    <origin xyz="0 -0.42 0.9" rpy="0 0 0"/>
  </joint>
  <joint name="post_right" type="fixed">
    <parent link="cabinet"/><child link="column_right"/>
    <origin xyz="0 0.42 0.9" rpy="0 0 0"/>
  </joint>
  <joint name="gantry_x" type="prismatic">
    <parent link="cabinet"/><child link="bridge"/>
    <origin xyz="0 0 1.5" rpy="0 0 0"/>
    <axis xyz="1 0 0"/>
    <limit lower="-0.5" upper="0.5" effort="200" velocity="0.8"/>
  </joint>
  <joint name="head_z" type="prismatic">
    <parent link="bridge"/><child link="inspection_head"/>
    <origin xyz="0 0 -0.12" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-0.3" upper="0.0" effort="120" velocity="0.5"/>
  </joint>
  <joint name="optic" type="fixed">
    <parent link="inspection_head"/><child link="lens"/>
    <origin xyz="0 0 -0.22" rpy="0 0 0"/>
  </joint>
</robot>`;

/** A minimal 2-DOF planar arm (both revolute about Z) — tiny fixture for parser tests. */
export const SAMPLE_URDF_2DOF_PLANAR = `<?xml version="1.0"?>
<robot name="sample_2dof_planar">
  <link name="base">
    <visual><origin xyz="0 0 0" rpy="0 0 0"/><geometry><box size="0.1 0.1 0.05"/></geometry></visual>
  </link>
  <link name="upper">
    <visual><origin xyz="0.1 0 0" rpy="0 0 0"/><geometry><box size="0.2 0.04 0.04"/></geometry></visual>
    <collision><origin xyz="0.1 0 0" rpy="0 0 0"/><geometry><box size="0.2 0.04 0.04"/></geometry></collision>
  </link>
  <link name="fore">
    <visual><origin xyz="0.075 0 0" rpy="0 0 0"/><geometry><box size="0.15 0.03 0.03"/></geometry></visual>
    <collision><origin xyz="0.075 0 0" rpy="0 0 0"/><geometry><box size="0.15 0.03 0.03"/></geometry></collision>
  </link>

  <joint name="j1" type="revolute">
    <parent link="base"/><child link="upper"/>
    <origin xyz="0 0 0.05" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-2.4435" upper="2.4435" effort="80" velocity="3.0"/>
  </joint>
  <joint name="j2" type="revolute">
    <parent link="upper"/><child link="fore"/>
    <origin xyz="0.2 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-2.618" upper="2.618" effort="60" velocity="3.0"/>
  </joint>
</robot>`;
