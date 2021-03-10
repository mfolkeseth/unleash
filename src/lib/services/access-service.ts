import { AccessStore, Role, Permission } from '../db/access-store';
import p from '../permissions';
import User from '../user';

export const ALL_PROJECTS = '*';

const { ADMIN } = p;

const PROJECT_ADMIN = [
    p.UPDATE_PROJECT,
    p.DELETE_PROJECT,
    p.CREATE_FEATURE,
    p.UPDATE_FEATURE,
    p.DELETE_FEATURE,
];

const PROJECT_REGULAR = [p.CREATE_FEATURE, p.UPDATE_FEATURE, p.DELETE_FEATURE];

const isProjectPermission = permission => PROJECT_ADMIN.includes(permission);

interface Stores {
    accessStore: AccessStore;
    userStore: any;
}

export interface UserWithRole {
    id: number;
    roleId: number;
    name?: string
    username?: string;
    email?: string;
    imageUrl?: string;
}

interface RoleData {
    role: Role;
    users: User[];
    permissions: Permission[];
}

interface IPermission {
    name: string;
    type: PermissionType;
}

enum PermissionType {
    root='root',
    project='project',
}

export enum RoleType {
    ADMIN = 'Admin',
    REGULAR = 'Regular',
    READ = 'Read',
}


// TODO: Split this in two concerns. 1: Controlling access, 2: managing roles (rbac).
export class AccessService {
    public RoleType = RoleType;
    private store: AccessStore;

    private userStore: any;

    private logger: any;

    private permissions: IPermission[];

    constructor({ accessStore, userStore }: Stores, { getLogger } : { getLogger: Function}) {
        this.store = accessStore;
        this.userStore = userStore;
        this.logger = getLogger('/services/access-service.ts');
        this.permissions = Object.values(p).map(p => ({
            name: p,
            type: isProjectPermission(p) ? PermissionType.project : PermissionType.root
        }))
    }

    /**
     * Used to check if a user has access to the requested resource
     * 
     * @param user 
     * @param permission 
     * @param projectId 
     */
    async hasPermission(user: User, permission: string, projectId?: string): Promise<boolean> {
        //TODO: require that project specific permissions specify projectId!

        this.logger.info(`Checking permission=${permission}, userId=${user.id} projectId=${projectId}`)

        const permissions = await this.store.getPermissionsForUser(user.id);

        return permissions
                .filter(p => !p.project || p.project === projectId || p.project === ALL_PROJECTS)
                .some(p => p.permission === permission || p.permission === ADMIN);
    }

    getPermissions(): IPermission[] {
        return this.permissions;
    }

    async addUserToRole(userId: number, roleId: number) {
        return this.store.addUserToRole(userId, roleId);
    }

    async setUserRootRole(userId: number, roleType: RoleType ) {
        const userRoles = await this.store.getRolesForUserId(userId);
        const currentRootRoles = userRoles.filter(r => r.type === 'root');

        const roles = await this.getRoles();
        const role = roles.find(r => r.type === 'root' && r.name === roleType);
        if(role) {
            try {
                await Promise.all(currentRootRoles.map(r => this.store.removeUserFromRole(userId, r.id)));
                await this.store.addUserToRole(userId, role.id);
            } catch (error) {
                this.logger.warn('Could not add role=${roleType} to userId=${userId}');
            }
        }
    }

    async removeUserFromRole(userId: number, roleId: number) {
        return this.store.removeUserFromRole(userId, roleId);
    }

    async addPermissionToRole(roleId: number, permission: string, projectId?: string) {
        if(isProjectPermission(permission) && !projectId) {
            throw new Error(`ProjectId cannot be empty for permission=${permission}`)
        } 
        return this.store.addPermissionsToRole(roleId, [permission], projectId);
    }

    async removePermissionFromRole(roleId: number, permission: string, projectId?: string) {
        if(isProjectPermission(permission) && !projectId) {
            throw new Error(`ProjectId cannot be empty for permission=${permission}`)
        }
        return this.store.removePermissionFromRole(roleId, permission, projectId);
    }

    async getRoles(): Promise<Role[]> {
        return this.store.getRoles();
    }

    async getRole(roleId: number): Promise<RoleData> {
        const [role, permissions, users] = await Promise.all([
            this.store.getRoleWithId(roleId),
            this.store.getPermissionsForRole(roleId),
            this.getUsersForRole(roleId),
        ]);
        return { role, permissions, users };
    }

    async getRolesForProject(projectId: string): Promise<Role[]> {
        return this.store.getRolesForProject(projectId);
    }

    async getRolesForUser(userId: number): Promise<Role[]> {
        return this.store.getRolesForUserId(userId);
    }

    async getUsersForRole(roleId) : Promise<User[]> {
        const userIdList = await this.store.getUserIdsForRole(roleId);
        return this.userStore.getAllWithId(userIdList);
    }

    // Move to project-service?
    async getProjectRoleUsers(projectId: string): Promise<[Role[], UserWithRole[]]> {
        const roles = await this.store.getRolesForProject(projectId);

        const users = await Promise.all(roles.map(async role => {
            const users = await this.getUsersForRole(role.id);
            return users.map(u => ({ ...u, roleId: role.id }))
        }));
        return [roles, users.flat()];
    }

    async createDefaultProjectRoles(owner: User, projectId: string) {
        if(!projectId) {
            throw new Error("ProjectId cannot be empty");
        }

        const adminRole = await this.store.createRole(
            RoleType.ADMIN,
            'project-admin', //TODO: constant
            projectId,
            `Admin role for project "${projectId}"`,
        );
        await this.store.addPermissionsToRole(
            adminRole.id,
            PROJECT_ADMIN,
            projectId,
        );

        // TODO: remove this when all users is guaranteed to have a unique id. 
        if (owner.id) {
            this.logger.info(`Making ${owner.id} admin of ${projectId} via roleId=${adminRole.id}`);
            await this.store.addUserToRole(owner.id, adminRole.id);    
        };
        
        const regularRole = await this.store.createRole(
            RoleType.REGULAR,
            'project-regular',  //TODO: constant
            projectId,
            `Contributor role for project "${projectId}"`,
        );
        await this.store.addPermissionsToRole(
            regularRole.id,
            PROJECT_REGULAR,
            projectId
        );
    }

    async removeDefaultProjectRoles(owner: User, projectId: string) {
        this.logger.info(`Removing project roles for ${projectId}`);
        return this.store.removeRolesForProject(projectId);
    }
}
